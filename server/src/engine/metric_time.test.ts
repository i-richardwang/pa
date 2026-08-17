import { describe, expect, test } from "bun:test";
import type { CubeMember } from "../ports/cube_gateway.js";
import { physicalEvaluation, resolveMetricTime } from "./metric_time.js";

function member(
  name: string,
  contract?: Record<string, unknown>,
  components?: { numerator: string; denominator: string },
): CubeMember {
  return {
    name,
    title: name,
    type: "number",
    meta: {
      ...(contract ? { time_contract: contract } : {}),
      ...(components ? { components } : {}),
    },
  };
}

function memberMap(...members: CubeMember[]): Map<string, CubeMember> {
  return new Map(members.map((candidate) => [candidate.name, candidate]));
}

describe("指标时间合同", () => {
  test("sum、average 与 last 映射为最小物理求值形态", () => {
    const sum = member("metrics.leavers", { aggregation: "sum", window: "selected" });
    const average = member("metrics.average_headcount", {
      aggregation: "average",
      window: "selected",
    });
    const last = member("metrics.active_employee_count", {
      aggregation: "last",
      window: "selected",
    });
    const members = memberMap(sum, average, last);

    expect(resolveMetricTime(sum, members).evaluation).toBe("interval");
    expect(resolveMetricTime(average, members).evaluation).toBe("interval");
    expect(resolveMetricTime(last, members).evaluation).toBe("endpoint");
  });

  test("year_to_date 保留逻辑窗口，物理上在目标桶终点读取 rolling measure", () => {
    const ytd = member("metrics.ytd_rate", {
      aggregation: "recompute",
      window: "year_to_date",
    });
    const resolved = resolveMetricTime(ytd, memberMap(ytd));

    expect(resolved.evaluation).toBe("year_to_date");
    expect(physicalEvaluation(resolved.evaluation)).toBe("endpoint");
  });

  test("按月重算的比例不要求分子与分母具有相同的跨月形态", () => {
    const leavers = member("metrics.leavers", { aggregation: "sum", window: "selected" });
    const active_employee_count = member("metrics.active_employee_count", {
      aggregation: "last",
      window: "selected",
    });
    const rate = member(
      "metrics.monthly_rate",
      { aggregation: "recompute", window: "selected", grain: "month" },
      { numerator: "leavers", denominator: "active_employee_count" },
    );

    expect(
      resolveMetricTime(rate, memberMap(leavers, active_employee_count, rate)).evaluation,
    ).toBe("interval");
  });

  test("非月度重算比例继承两个组件的一致形态", () => {
    const capacity = member("metrics.capacity", { aggregation: "last", window: "selected" });
    const active_employee_count = member("metrics.active_employee_count", {
      aggregation: "last",
      window: "selected",
    });
    const utilization = member(
      "metrics.utilization",
      { aggregation: "recompute", window: "selected" },
      { numerator: "active_employee_count", denominator: "capacity" },
    );

    expect(
      resolveMetricTime(utilization, memberMap(capacity, active_employee_count, utilization))
        .evaluation,
    ).toBe("endpoint");
  });

  test("非月度重算比例混合区间与终点组件时 fail-closed", () => {
    const leavers = member("metrics.leavers", { aggregation: "sum", window: "selected" });
    const active_employee_count = member("metrics.active_employee_count", {
      aggregation: "last",
      window: "selected",
    });
    const rate = member(
      "metrics.rate",
      { aggregation: "recompute", window: "selected" },
      { numerator: "leavers", denominator: "active_employee_count" },
    );

    expect(() => resolveMetricTime(rate, memberMap(leavers, active_employee_count, rate))).toThrow(
      /应由指标 DAG 拆分组件后重算/,
    );
  });

  test("缺失或非法合同不会静默回退", () => {
    const missing = member("metrics.missing");
    const invalid = member("metrics.invalid", { aggregation: "sum", window: "forever" });

    expect(() => resolveMetricTime(missing, memberMap(missing))).toThrow(/缺少有效的时间聚合合同/);
    expect(() => resolveMetricTime(invalid, memberMap(invalid))).toThrow(/缺少有效的时间聚合合同/);
  });

  test("年初归零与按月定义不能并存：整窗合并的降级期间会自相矛盾", () => {
    const contradictory = member("metrics.contradictory", {
      aggregation: "recompute",
      window: "year_to_date",
      grain: "month",
    });
    expect(() => resolveMetricTime(contradictory, memberMap(contradictory))).toThrow(
      /缺少有效的时间聚合合同/,
    );
    const ytd = member("metrics.ytd", { aggregation: "recompute", window: "year_to_date" });
    const monthly = member("metrics.monthly", {
      aggregation: "recompute",
      window: "selected",
      grain: "month",
    });
    expect(resolveMetricTime(ytd, memberMap(ytd)).evaluation).toBe("year_to_date");
    expect(resolveMetricTime(monthly, memberMap(monthly)).contract.grain).toBe("month");
  });
});
