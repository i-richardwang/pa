import { expect, test } from "bun:test";
import type { ViewBlock } from "@payload";
import {
  recordProjectionCoordinates,
  recordProjectionTimeCoordinate,
} from "./record_projection_request.js";

function view(overrides: Partial<ViewBlock>): ViewBlock {
  return {
    id: "result",
    columns: ["year", "month", "organization_name", "active_employee_count"],
    column_roles: {
      year: "time",
      month: "time",
      organization_name: "dimension",
      active_employee_count: "measure",
    },
    rows: [[2026, 7, "研发", 10]],
    row_count: 1,
    time: {
      grain: "month",
      coordinates: [{ role: "primary", from: "2026-07", to: "2026-07" }],
      buckets: [{ key: { year: 2026, month: 7 }, from: "2026-07", to: "2026-07" }],
    },
    query_notes: [],
    ...overrides,
  };
}

test("月度格子解析为确定的自然月窗口", () => {
  expect(recordProjectionTimeCoordinate(view({}), 0)).toEqual({ from: "2026-07", to: "2026-07" });
});

test("年度格子裁出对应报告窗口；总计格复用已解析窗口而不重算最新月", () => {
  expect(
    recordProjectionTimeCoordinate(
      view({
        columns: ["year", "active_employee_count"],
        rows: [[2026, 10]],
        time: {
          grain: "year",
          coordinates: [{ role: "primary", from: "2026-01", to: "2026-02" }],
          buckets: [{ key: { year: 2026 }, from: "2026-01", to: "2026-02" }],
        },
      }),
      0,
    ),
  ).toEqual({ from: "2026-01", to: "2026-02" });
  expect(
    recordProjectionTimeCoordinate(
      view({
        columns: ["active_employee_count"],
        rows: [[10]],
        time: {
          grain: "total",
          coordinates: [{ role: "primary", from: "2026-01", to: "2026-07" }],
          buckets: [{ key: null, from: "2026-01", to: "2026-07" }],
        },
      }),
      0,
    ),
  ).toEqual({ from: "2026-01", to: "2026-07" });
});

test("显式携带的覆盖期间优先于行桶：指标卡的大数下钻用它自己的期间", () => {
  const monthly = view({
    columns: ["year", "month", "active_employee_count"],
    rows: [
      [2025, 9, 10],
      [2026, 8, 12],
    ],
    time: {
      grain: "month",
      coordinates: [{ role: "primary", from: "2025-09", to: "2026-08" }],
      buckets: [
        { key: { year: 2025, month: 9 }, from: "2025-09", to: "2025-09" },
        { key: { year: 2026, month: 8 }, from: "2026-08", to: "2026-08" },
      ],
    },
  });
  expect(recordProjectionTimeCoordinate(monthly, 0, { from: "2025-09", to: "2026-08" })).toEqual({
    from: "2025-09",
    to: "2026-08",
  });
  expect(recordProjectionTimeCoordinate(monthly, 0)).toEqual({ from: "2025-09", to: "2025-09" });
});

test("格子坐标只取编译器声明且该行实际存在的分组值，null 原样保留", () => {
  const source = view({
    columns: ["organization_name", "department_name", "active_employee_count"],
    rows: [["研发", null, 10]],
  });

  expect(
    recordProjectionCoordinates(source, 0, {
      organization_name: { dimension_id: "dimension:t0" },
      department_name: { dimension_id: "dimension:t1" },
      missing: { dimension_id: "dimension:missing" },
    }),
  ).toEqual([
    { dimension_id: "dimension:t0", value: "研发" },
    { dimension_id: "dimension:t1", value: null },
  ]);
});

/** 2024-06 至 2026-07 按年：首桶是部分年，物理执行方式不进入结果契约。 */
function partialYearView(overrides: Partial<ViewBlock> = {}): ViewBlock {
  return view({
    columns: ["organization_name", "year", "active_employee_count", "turnover_count"],
    column_roles: {
      organization_name: "dimension",
      year: "time",
      active_employee_count: "measure",
      turnover_count: "measure",
    },
    rows: [
      ["示例组织甲", "2024", 1, 1],
      ["示例组织甲", "2025", 1, 1],
      ["示例组织甲", "2026", 1, 1],
    ],
    row_count: 3,
    time: {
      grain: "year",
      coordinates: [{ role: "primary", from: "2024-06", to: "2026-07" }],
      buckets: [
        { key: { year: 2024 }, from: "2024-06", to: "2024-12" },
        { key: { year: 2025 }, from: "2025-01", to: "2025-12" },
        { key: { year: 2026 }, from: "2026-01", to: "2026-07" },
      ],
    },
    ...overrides,
  });
}

test("按年结果逐行落到自己的桶，部分年保留真实起点，中间年份逐一有解", () => {
  const source = partialYearView();
  expect(recordProjectionTimeCoordinate(source, 0)).toEqual({ from: "2024-06", to: "2024-12" });
  expect(recordProjectionTimeCoordinate(source, 1)).toEqual({ from: "2025-01", to: "2025-12" });
  expect(recordProjectionTimeCoordinate(source, 2)).toEqual({ from: "2026-01", to: "2026-07" });
});

test("行匹配不到唯一桶时不投影记录，不猜时间范围", () => {
  const missing = partialYearView({
    rows: [["示例组织甲", "2023", 1, 1]],
    row_count: 1,
  });
  expect(recordProjectionTimeCoordinate(missing, 0)).toBeNull();
  const ambiguous = partialYearView({
    time: {
      grain: "year",
      coordinates: [{ role: "primary", from: "2024-06", to: "2026-07" }],
      buckets: [
        { key: { year: 2024 }, from: "2024-06", to: "2024-12" },
        { key: { year: 2024 }, from: "2024-01", to: "2024-12" },
      ],
    },
  });
  expect(recordProjectionTimeCoordinate(ambiguous, 0)).toBeNull();
});

test("无时间列的结果整份同属一个桶", () => {
  const total = view({
    columns: ["organization_name", "active_employee_count"],
    rows: [["示例组织甲", 10]],
    time: {
      grain: "total",
      coordinates: [{ role: "primary", from: "2026-01", to: "2026-06" }],
      buckets: [{ key: null, from: "2026-01", to: "2026-06" }],
    },
  });
  expect(recordProjectionTimeCoordinate(total, 0)).toEqual({ from: "2026-01", to: "2026-06" });
});

test("缺少逻辑时间时不回退猜测物理窗口", () => {
  expect(recordProjectionTimeCoordinate(view({ time: undefined }), 0)).toBeNull();
});
