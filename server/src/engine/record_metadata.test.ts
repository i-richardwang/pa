import { describe, expect, test } from "bun:test";
import type { CubeView } from "../ports/cube_gateway.js";
import { recordSetsOf, resolveRecordProjectionTarget } from "./record_metadata.js";

const records = (selection: Record<string, unknown>) => ({
  time_contract: { aggregation: "sum", window: "year_to_date" },
  underlying_records: { record_set: "employee", selection },
});

function fixture(): CubeView {
  return {
    name: "test_people_metrics",
    title: "人员明细",
    meta: {
      record_sets: {
        employee: {
          title: "员工记录",
          description: "构成指标结果的员工记录。",
          record_key: "record_key",
          entity_key: "employee_id",
          fields: [{ member: "employee_id" }, { member: "employee_name", title: "员工姓名" }],
          entity_order: [{ member: "record_key", direction: "asc" }],
        },
      },
    },
    measures: [
      {
        name: "test_people_metrics.turnover_count",
        title: "YTD事件数",
        type: "number",
        aggType: "countDistinct",
        meta: records({ kind: "self" }),
      },
      {
        name: "test_people_metrics.leave_rate",
        title: "YTD事件率",
        type: "number",
        aggType: "number",
        meta: {
          ...records({ kind: "numerator" }),
          components: {
            numerator: "turnover_count",
            denominator: "average_entity_count",
          },
        },
      },
      {
        name: "test_people_metrics.average_entity_count",
        title: "YTD月均基数",
        type: "number",
        aggType: "avg",
        meta: { time_contract: { aggregation: "average", window: "year_to_date" } },
      },
      {
        name: "test_people_metrics.guarded_turnover_count",
        title: "YTD资格事件数",
        type: "number",
        aggType: "number",
        meta: records({ kind: "measure", member: "raw_turnover_count" }),
      },
    ],
    internalMeasures: [
      {
        name: "test_people_metrics.raw_turnover_count",
        title: "基础离职人数",
        type: "number",
        aggType: "countDistinct",
        meta: {
          internal: true,
          time_contract: { aggregation: "sum", window: "year_to_date" },
        },
      },
    ],
    dimensions: [],
    internalDimensions: [
      { name: "test_people_metrics.record_key", title: "行键", type: "string" },
      { name: "test_people_metrics.employee_id", title: "员工编号", type: "string" },
      { name: "test_people_metrics.employee_name", title: "姓名", type: "string" },
    ],
  };
}

describe("指标记录投影契约", () => {
  test("技术明细面一次声明记录集并校验引用完整性", () => {
    expect(recordSetsOf(fixture()).get("employee")).toEqual({
      title: "员工记录",
      description: "构成指标结果的员工记录。",
      rowKey: "record_key",
      entityKey: "employee_id",
      fields: [{ member: "employee_id" }, { member: "employee_name", title: "员工姓名" }],
      entityOrder: [{ member: "record_key", direction: "asc" }],
    });

    const invalid = fixture();
    invalid.meta = {
      record_sets: {
        employee: {
          title: "员工记录",
          description: "构成指标结果的员工记录。",
          record_key: "record_key",
          entity_key: "employee_id",
          fields: [{ member: "employee_id" }, { member: "missing" }],
          entity_order: [{ member: "record_key", direction: "asc" }],
        },
      },
    };
    expect(() => recordSetsOf(invalid)).toThrow("底层记录集配置无效");

    const unstable = fixture();
    unstable.meta = {
      record_sets: {
        employee: {
          title: "员工记录",
          description: "构成指标结果的员工记录。",
          record_key: "record_key",
          entity_key: "employee_id",
          fields: [{ member: "employee_id" }, { member: "employee_name" }],
          entity_order: [{ member: "employee_name", direction: "asc" }],
        },
      },
    };
    expect(() => recordSetsOf(unstable)).toThrow("底层记录集配置无效");
  });

  test("只对显式声明的指标解析 self、numerator 与 measure 记录选择", () => {
    const view = fixture();
    expect(resolveRecordProjectionTarget(view, "test_people_metrics.turnover_count")).toMatchObject(
      {
        member: "test_people_metrics.turnover_count",
        mode: "entities",
        title: "YTD事件数",
        recordSet: "employee",
      },
    );
    expect(resolveRecordProjectionTarget(view, "test_people_metrics.leave_rate")).toMatchObject({
      member: "test_people_metrics.turnover_count",
      mode: "entities",
      title: "YTD事件率",
    });
    expect(
      resolveRecordProjectionTarget(view, "test_people_metrics.guarded_turnover_count"),
    ).toMatchObject({
      member: "test_people_metrics.raw_turnover_count",
      mode: "entities",
      title: "YTD资格事件数",
    });
    expect(
      resolveRecordProjectionTarget(view, "test_people_metrics.average_entity_count"),
    ).toBeNull();
  });

  test("契约缺失、目标错误、循环和时间口径漂移在目录装配前失败", () => {
    const missingSet = fixture();
    missingSet.measures[0].meta = {
      ...records({ kind: "self" }),
      underlying_records: {
        record_set: "missing",
        selection: { kind: "self" },
      },
    };
    expect(() => resolveRecordProjectionTarget(missingSet, missingSet.measures[0].name)).toThrow(
      "不存在的底层记录集",
    );

    const missingTarget = fixture();
    missingTarget.measures[3].meta = records({ kind: "measure", member: "missing" });
    expect(() =>
      resolveRecordProjectionTarget(missingTarget, missingTarget.measures[3].name),
    ).toThrow("目标不存在");

    const invalidSelf = fixture();
    invalidSelf.measures[2].meta = records({ kind: "self" });
    expect(() => resolveRecordProjectionTarget(invalidSelf, invalidSelf.measures[2].name)).toThrow(
      "不是可枚举计数",
    );

    const cycle = fixture();
    cycle.measures[2].meta = records({ kind: "measure", member: "guarded_turnover_count" });
    cycle.measures[3].meta = records({
      kind: "measure",
      member: "average_entity_count",
    });
    expect(() => resolveRecordProjectionTarget(cycle, cycle.measures[2].name)).toThrow("存在循环");

    const drift = fixture();
    drift.internalMeasures![0].meta = {
      internal: true,
      time_contract: { aggregation: "sum", window: "selected" },
    };
    expect(() => resolveRecordProjectionTarget(drift, drift.measures[3].name)).toThrow(
      "时间口径不一致",
    );
  });
});
