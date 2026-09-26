import { describe, expect, test } from "bun:test";
import type { CubeMember } from "../ports/cube_gateway.js";
import { physicalForm, resolveMetricTime } from "./metric_time.js";

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

describe("指标的业务求值基准", () => {
  test("sum、average 覆盖整个桶，last 只覆盖桶末", () => {
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

    expect(resolveMetricTime(sum, members).basis).toBe("whole_bucket");
    expect(resolveMetricTime(average, members).basis).toBe("whole_bucket");
    expect(resolveMetricTime(last, members).basis).toBe("bucket_end");
  });

  test("年初累计保留业务窗口，物理上仍在桶终点读取 rolling measure", () => {
    const ytd = member("metrics.ytd_rate", {
      aggregation: "recompute",
      window: "year_to_date",
    });
    const resolved = resolveMetricTime(ytd, memberMap(ytd));

    expect(resolved.basis).toBe("year_start_to_bucket_end");
    expect(physicalForm(resolved.basis)).toBe("endpoint");
  });

  test("按月重算的比例不要求分子与分母具有相同的基准", () => {
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

    expect(resolveMetricTime(rate, memberMap(leavers, active_employee_count, rate)).basis).toBe(
      "whole_bucket",
    );
  });

  test("非月度重算比例继承两个组件的一致基准", () => {
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
      resolveMetricTime(utilization, memberMap(capacity, active_employee_count, utilization)).basis,
    ).toBe("bucket_end");
  });

  test("非月度重算比例混合期间值与时点值组件时报错", () => {
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

  test("合同缺失或无效时报错，不使用默认值", () => {
    const missing = member("metrics.missing");
    const invalid = member("metrics.invalid", { aggregation: "sum", window: "forever" });

    expect(() => resolveMetricTime(missing, memberMap(missing))).toThrow(/缺少有效的时间聚合合同/);
    expect(() => resolveMetricTime(invalid, memberMap(invalid))).toThrow(/缺少有效的时间聚合合同/);
  });

  test("年初累计与按月定义不能同时声明", () => {
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
    expect(resolveMetricTime(ytd, memberMap(ytd)).basis).toBe("year_start_to_bucket_end");
    expect(resolveMetricTime(monthly, memberMap(monthly)).contract.grain).toBe("month");
  });
});
