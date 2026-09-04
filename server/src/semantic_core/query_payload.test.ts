/**
 * 载荷契约纯函数单测：聚合全量行块（_meta / 重放通道）合并回唯一结果——
 * 渲染栈只消费合并后的 QueryPayload，此处是分流与复原的对称性保证。
 */
import { describe, expect, test } from "bun:test";
import {
  EXPORT_RESOURCE_LINK_SCHEMA,
  FULL_ROWS_BLOCK_SCHEMA,
  QUERY_PAYLOAD_SCHEMA,
  freshnessLabel,
  mergeFullRows,
  type QueryPayload,
} from "./query_payload.js";

const isQueryPayload = (value: unknown) => QUERY_PAYLOAD_SCHEMA.safeParse(value).success;
const isFullRowsBlock = (value: unknown, payload: QueryPayload) => {
  const parsed = FULL_ROWS_BLOCK_SCHEMA.safeParse(value);
  return (
    parsed.success && parsed.data.rows.every((row) => row.length === payload.view.columns.length)
  );
};
const isExportResourceLink = (value: unknown) =>
  EXPORT_RESOURCE_LINK_SCHEMA.safeParse(value).success;

const view = (rows: (string | number | null)[][], row_count: number) => ({
  id: "result",
  columns: ["org", "n"],
  column_roles: { org: "dimension" as const, n: "measure" as const },
  column_time_basis: { n: "bucket_end" as const },
  rows,
  row_count,
  time: {
    grain: "total" as const,
    coordinates: [{ role: "primary" as const, from: "2026-06", to: "2026-06" }],
    buckets: [{ key: null, from: "2026-06", to: "2026-06" }],
  },
  query_notes: [],
});

describe("freshnessLabel", () => {
  test("人员查询显示单一数据截至月", () => {
    expect(freshnessLabel(payload(view([], 0)))).toBe("数据截至 2026-06");
  });

  test("编制查询区分实际与未来计划截至月", () => {
    const p = payload(view([], 0));
    p.time_context = [
      {
        title: "人员与编制数据",
        actual_through: "2026-07",
        plan_through: "2026-12",
        available_through: "2026-12",
      },
    ];
    expect(freshnessLabel(p)).toBe("实际截至 2026-07 · 计划截至 2026-12");
  });
});

const payload = (result: QueryPayload["view"]): QueryPayload => ({
  view: result,
  observation_scopes: ["统计范围"],
  data_as_of: "2026-06",
  time_context: [{ title: "人员数据", actual_through: "2026-06", available_through: "2026-06" }],
});

describe("mergeFullRows：全量行并回载荷", () => {
  test("无全量行块：载荷原样返回", () => {
    const p = payload(view([["a", 1]], 1));
    expect(mergeFullRows(p, undefined)).toBe(p);
    expect(mergeFullRows(p, null)).toBe(p);
  });

  test("被采样视图的 rows 替换为全量，row_count 与全量一致", () => {
    const full = Array.from({ length: 300 }, (_, i) => [`org${i}`, i]);
    const p = payload(view(full.slice(0, 200), 300));
    const merged = mergeFullRows(p, { rows: full });
    expect(merged.view.rows).toHaveLength(300);
    expect(merged.view.rows).toEqual(full);
    expect(merged.view.row_count).toBe(300);
  });

  test("合并不改共享头与结果其余字段", () => {
    const full = Array.from({ length: 201 }, (_, i) => [`org${i}`, i]);
    const p = payload({ ...view(full.slice(0, 200), 201), sampled: "样本注记" });
    const merged = mergeFullRows(p, { rows: full });
    expect(merged.observation_scopes).toBe(p.observation_scopes);
    expect(merged.view.sampled).toBe("样本注记");
  });
});

describe("求值基准在结果里只声明一次", () => {
  const totals = (periods: Record<string, unknown>[]) => ({
    metrics: [{ column: "n", periods }],
  });

  test("指标列必须声明基准，且只有指标列能声明", () => {
    const valid = payload(view([["a", 1]], 1));
    expect(isQueryPayload(valid)).toBe(true);
    // 少一个指标列：直查结果里「这个数代表什么时间」不许留空。
    expect(isQueryPayload({ ...valid, view: { ...valid.view, column_time_basis: {} } })).toBe(
      false,
    );
    // 多一个不存在的列：基准的键面必须就是指标列本身。
    expect(
      isQueryPayload({
        ...valid,
        view: { ...valid.view, column_time_basis: { n: "bucket_end", ghost: "bucket_end" } },
      }),
    ).toBe(false);
    // 声明在维度列上同样不成立。
    expect(
      isQueryPayload({
        ...valid,
        view: { ...valid.view, column_time_basis: { n: "bucket_end", org: "bucket_end" } },
      }),
    ).toBe(false);
  });

  test("合计位的期间只能是本列基准展开出来的那一段", () => {
    const valid = payload(view([["a", 1]], 1));
    const withTotals = (periods: Record<string, unknown>[]) => ({
      ...valid,
      view: { ...valid.view, totals: totals(periods) },
    });
    // 坐标是 2026-06 单月，时点值展开后仍是这一个月。
    expect(isQueryPayload(withTotals([{ from: "2026-06", to: "2026-06", value: 1 }]))).toBe(true);
    // 同一列不可能既是时点值又覆盖整年——基准只在列上，写不出这种矛盾，只能写错期间。
    expect(isQueryPayload(withTotals([{ from: "2026-01", to: "2026-06", value: 1 }]))).toBe(false);
    // 年初累计的期间对时点值列不成立。
    expect(
      isQueryPayload({
        ...valid,
        view: {
          ...valid.view,
          column_time_basis: { n: "year_start_to_bucket_end" },
          totals: totals([{ from: "2026-01", to: "2026-06", value: 1 }]),
        },
      }),
    ).toBe(true);
  });
});

describe("宿主载荷边界校验", () => {
  test("接受服务端契约并拒绝缺字段或非法单元格", () => {
    const valid = payload(view([["a", 1]], 1));
    expect(isQueryPayload(valid)).toBe(true);
    expect(isQueryPayload({ ...valid, view: undefined })).toBe(false);
    expect(isQueryPayload({ ...valid, time_context: undefined })).toBe(false);
    expect(isQueryPayload({ ...valid, view: { ...valid.view, column_roles: undefined } })).toBe(
      false,
    );
    expect(
      isQueryPayload({
        ...valid,
        view: { ...valid.view, column_roles: { org: "dimension" } },
      }),
    ).toBe(false);
    expect(isQueryPayload({ ...valid, view: { ...valid.view, time: undefined } })).toBe(false);
    expect(
      isQueryPayload({
        ...valid,
        view: { ...valid.view, time: { ...valid.view.time, coordinates: undefined } },
      }),
    ).toBe(false);
    expect(
      isQueryPayload({
        ...valid,
        view: {
          ...valid.view,
          time: {
            ...valid.view.time,
            coordinates: [{ role: "comparison", from: "2026-06", to: "2026-06" }],
          },
        },
      }),
    ).toBe(false);
    expect(
      isQueryPayload({
        ...valid,
        view: { ...valid.view, column_roles: { org: "time", n: "measure" } },
      }),
    ).toBe(false);
    expect(isQueryPayload({ ...valid, view: { ...valid.view, rows: [["a"]] } })).toBe(false);
    expect(isQueryPayload({ ...valid, view: { ...valid.view, rows: [["a", Number.NaN]] } })).toBe(
      false,
    );
    expect(
      isQueryPayload({
        ...valid,
        view: { ...valid.view, column_formats: { n: "percent" } },
      }),
    ).toBe(true);
    expect(
      isQueryPayload({
        ...valid,
        view: { ...valid.view, column_formats: { n: "percentage_point" } },
      }),
    ).toBe(true);
    expect(
      isQueryPayload({
        ...valid,
        view: { ...valid.view, column_formats: { n: "currency" } },
      }),
    ).toBe(false);
    expect(
      isQueryPayload({
        ...valid,
        view: {
          ...valid.view,
          columns: ["year", "n"],
          column_roles: { year: "time", n: "measure" },
          rows: [[2025, 1]],
          time: {
            grain: "year",
            coordinates: [{ role: "primary", from: "2026-01", to: "2026-06" }],
            buckets: [{ key: { year: 2026 }, from: "2026-01", to: "2026-06" }],
          },
        },
      }),
    ).toBe(false);
    expect(
      isQueryPayload({
        ...valid,
        view: { ...valid.view, column_formats: { missing: "percent" } },
      }),
    ).toBe(false);
    expect(
      isQueryPayload({
        ...valid,
        view: {
          ...valid.view,
          time: undefined,
          provenance: {
            sources: [{ title: "本期" }, { title: "上期" }],
            join_keys: [{ id: "dimension:organization_name", title: "组织" }],
            formula: "本期 − 上期",
          },
        },
      }),
    ).toBe(true);
    expect(
      isQueryPayload({
        ...valid,
        view: {
          ...valid.view,
          time: undefined,
          provenance: {
            sources: [{ title: "本期" }, { title: "上期" }],
            join_keys: [],
            formula: "",
          },
        },
      }),
    ).toBe(false);
    expect(
      isQueryPayload({
        ...valid,
        view: { ...valid.view, structure_shares: [{ measure: "n", numerator: "n" }] },
      }),
    ).toBe(true);
    expect(
      isQueryPayload({
        ...valid,
        view: { ...valid.view, structure_shares: [{ measure: "missing", numerator: "n" }] },
      }),
    ).toBe(false);
  });

  test("全量行校验列宽", () => {
    const valid = payload(view([["a", 1]], 1));
    expect(isFullRowsBlock({ rows: [["a", 1]] }, valid)).toBe(true);
    expect(isFullRowsBlock({ rows: [["a"]] }, valid)).toBe(false);
  });

  test("下载资源只接受 PA CSV resource_link", () => {
    const valid = {
      type: "resource_link",
      uri: "pa://export/e_abcdefghijklmnopqrstuvwxyz012345",
      name: "pa_export.csv",
      mimeType: "text/csv; charset=utf-8",
    };
    expect(isExportResourceLink(valid)).toBe(true);
    expect(isExportResourceLink({ ...valid, uri: "https://example.com/export.csv" })).toBe(false);
    expect(isExportResourceLink({ ...valid, mimeType: "application/octet-stream" })).toBe(false);
  });
});
