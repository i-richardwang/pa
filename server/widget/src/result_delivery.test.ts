import { describe, expect, test } from "bun:test";
import { compilePresentationBlock, PRESENTATION_META_KEY } from "@charts";
import { FULL_ROWS_META_KEY, type QueryPayload } from "@payload";
import { RECORD_PROJECTION_META_KEY, type RecordProjectionPayload } from "@records";
import { viewIdFrom, deliverAnalysisResult, deliverRecordProjection } from "./result_delivery.js";

const ANALYSIS_ID = "22222222-2222-4222-8222-222222222222";

const payload: QueryPayload = {
  view_id: ANALYSIS_ID,
  observation_scopes: ["统计范围"],
  data_as_of: "2026-07",
  time_context: [],
  view: {
    id: "result",
    columns: ["organization_name", "active_employee_count"],
    column_roles: { organization_name: "dimension", active_employee_count: "measure" },
    rows: [["A", 10]],
    row_count: 2,
    sampled: "模型仅接收头部样本。",
    time: {
      grain: "total",
      coordinates: [{ role: "primary", from: "2026-07", to: "2026-07" }],
      buckets: [{ key: null, from: "2026-07", to: "2026-07" }],
    },
    query_notes: [],
  },
};

describe("result delivery", () => {
  test("只从结构化通道接收结果，并合并 _meta 全量行", () => {
    const fullRows = [
      ["A", 10],
      ["B", 20],
    ];
    expect(
      deliverAnalysisResult({
        content: [{ type: "text", text: "这不是结果协议" }],
        structuredContent: payload,
        _meta: {
          [FULL_ROWS_META_KEY]: {
            rows: fullRows,
          },
          [PRESENTATION_META_KEY]: compilePresentationBlock(
            { ...payload.view, rows: fullRows },
            { type: "table" },
          ),
        },
      }),
    ).toMatchObject({
      ok: true,
      payload: {
        view: {
          rows: [
            ["A", 10],
            ["B", 20],
          ],
        },
      },
    });
  });

  test("structuredContent 缺失时不解析 content JSON", () => {
    expect(
      deliverAnalysisResult({
        content: [{ type: "text", text: JSON.stringify(payload) }],
      }),
    ).toEqual({ ok: false, error: "查询结果缺少结构化载荷。" });
  });

  test("工具错误沿用服务端文本，协议错误使用稳定提示", () => {
    expect(
      deliverAnalysisResult({
        isError: true,
        content: [{ type: "text", text: "分析不存在、已过期或无权访问" }],
      }),
    ).toEqual({ ok: false, error: "分析不存在、已过期或无权访问" });
    expect(deliverAnalysisResult({ structuredContent: { view_id: ANALYSIS_ID } })).toEqual({
      ok: false,
      error: "查询结果不符合结果卡载荷契约。",
    });
  });

  test("只接受 show_analysis 契约中的 UUID", () => {
    expect(viewIdFrom({ view_id: ANALYSIS_ID })).toBe(ANALYSIS_ID);
    expect(viewIdFrom({ view_id: "not-an-id" })).toBeUndefined();
    expect(viewIdFrom(undefined)).toBeUndefined();
  });

  test("人员记录只从 App 私有 _meta 读取，不从模型可见通道恢复", () => {
    const records: RecordProjectionPayload = {
      metric_id: "measure:active_employee_count",
      metric_title: "在职人数",
      record_set_title: "在职员工",
      record_set_description: "构成在职人数的员工记录。",
      columns: ["员工编号", "姓名"],
      column_keys: ["employee_id", "employee_name"],
      rows: [["e_001", "张三"]],
      offset: 0,
      page_size: 20,
      has_more: false,
      data_as_of: "2026-07",
      data_changed: false,
    };
    expect(
      deliverRecordProjection({
        content: [{ type: "text", text: "人员名单已打开。" }],
        structuredContent: { view_id: ANALYSIS_ID, rows: [["伪造姓名"]] },
        _meta: { [RECORD_PROJECTION_META_KEY]: records },
      }),
    ).toEqual({ ok: true, payload: records });
    expect(
      deliverRecordProjection({
        structuredContent: { view_id: ANALYSIS_ID, ...records },
      }),
    ).toEqual({ ok: false, error: "构成记录缺少有效的受控记录载荷。" });
  });
});
