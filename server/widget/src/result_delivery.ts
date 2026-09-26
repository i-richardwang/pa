/**
 * 把工具结果解析成卡片载荷。数据只从 structuredContent 和私有 `_meta` 读取，各自按契约 schema 解析；
 * content 是给模型和用户看的文本，只用来取错误说明，不从中解析 JSON。
 */
import { PRESENTATION_META_KEY, type PresentationBlock } from "@charts";
import { isPresentationBlock } from "@presentation-guard";
import {
  EXPORT_RESOURCE_LINK_SCHEMA,
  EXPORT_RESOURCE_META_KEY,
  FULL_ROWS_BLOCK_SCHEMA,
  FULL_ROWS_META_KEY,
  mergeFullRows,
  QUERY_PAYLOAD_SCHEMA,
  type ExportResourceLink,
  type QueryPayload,
} from "@payload";
import {
  RECORD_PROJECTION_PAYLOAD_SCHEMA,
  RECORD_PROJECTION_META_KEY,
  type RecordProjectionPayload,
} from "@records";

export type ToolResult = {
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
};

export type DeliveredAnalysis =
  | {
      ok: true;
      payload: QueryPayload;
      presentation: PresentationBlock;
      exportResource: ExportResourceLink | null;
    }
  | { ok: false; error: string };

export type DeliveredRecords =
  | { ok: true; payload: RecordProjectionPayload }
  | { ok: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function firstText(content: ToolResult["content"]): string | undefined {
  return content?.find((item) => item.type === "text")?.text;
}

export function viewIdFrom(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("view_id" in value)) return undefined;
  const viewId = (value as { view_id?: unknown }).view_id;
  return typeof viewId === "string" && UUID_PATTERN.test(viewId) ? viewId : undefined;
}

export function deliverAnalysisResult(result: ToolResult): DeliveredAnalysis {
  if (result.isError) {
    return { ok: false, error: firstText(result.content) ?? "查询失败。" };
  }
  if (result.structuredContent === undefined) {
    return { ok: false, error: "查询结果缺少结果数据。" };
  }
  const payload = QUERY_PAYLOAD_SCHEMA.safeParse(result.structuredContent);
  if (!payload.success) {
    return { ok: false, error: "查询结果的数据格式无效。" };
  }

  // schema 只校验形状；全量行的列数还要与本次 payload 的列数一致
  const width = payload.data.view.columns.length;
  const fullRows = FULL_ROWS_BLOCK_SCHEMA.optional().safeParse(result._meta?.[FULL_ROWS_META_KEY]);
  if (!fullRows.success || fullRows.data?.rows.some((row) => row.length !== width)) {
    return { ok: false, error: "查询结果的完整行数据格式无效。" };
  }
  const resource = EXPORT_RESOURCE_LINK_SCHEMA.optional().safeParse(
    result._meta?.[EXPORT_RESOURCE_META_KEY],
  );
  if (!resource.success) {
    return { ok: false, error: "查询结果的下载资源格式无效。" };
  }

  const presentation = result._meta?.[PRESENTATION_META_KEY];
  if (!isPresentationBlock(presentation)) {
    return { ok: false, error: "查询结果缺少图表配置。" };
  }
  return {
    ok: true,
    payload: mergeFullRows(payload.data, fullRows.data),
    presentation,
    exportResource: resource.data ?? null,
  };
}

/** 逐人记录只从私有 `_meta` 读取；structuredContent 和 content 中即使有同名字段也不读。 */
export function deliverRecordProjection(result: ToolResult): DeliveredRecords {
  if (result.isError) {
    return { ok: false, error: firstText(result.content) ?? "构成记录加载失败。" };
  }
  const parsed = RECORD_PROJECTION_PAYLOAD_SCHEMA.safeParse(
    result._meta?.[RECORD_PROJECTION_META_KEY],
  );
  return parsed.success
    ? { ok: true, payload: parsed.data }
    : { ok: false, error: "构成记录的数据格式无效。" };
}
