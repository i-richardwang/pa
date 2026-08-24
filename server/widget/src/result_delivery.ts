/**
 * 工具结果 → 卡片载荷。App 只接受 MCP 的结构化结果通道：structuredContent 与私有 `_meta`
 * 各按契约 schema 解析，content 是面向模型/用户的文本退路，只用来取错误说明，
 * 不承担 iframe 数据协议，也不尝试从宿主包装文本中恢复 JSON。
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
    return { ok: false, error: "查询结果缺少结构化载荷。" };
  }
  const payload = QUERY_PAYLOAD_SCHEMA.safeParse(result.structuredContent);
  if (!payload.success) {
    return { ok: false, error: "查询结果不符合结果卡载荷契约。" };
  }

  // 全量行必须与公共载荷同宽：schema 只管形状，宽度对不对要看这一份 payload
  const width = payload.data.view.columns.length;
  const fullRows = FULL_ROWS_BLOCK_SCHEMA.optional().safeParse(result._meta?.[FULL_ROWS_META_KEY]);
  if (!fullRows.success || fullRows.data?.rows.some((row) => row.length !== width)) {
    return { ok: false, error: "查询结果的全量行数据格式无效。" };
  }
  const resource = EXPORT_RESOURCE_LINK_SCHEMA.optional().safeParse(
    result._meta?.[EXPORT_RESOURCE_META_KEY],
  );
  if (!resource.success) {
    return { ok: false, error: "查询结果的下载资源格式无效。" };
  }

  const presentation = result._meta?.[PRESENTATION_META_KEY];
  if (!isPresentationBlock(presentation)) {
    return { ok: false, error: "查询结果缺少有效的服务端呈现配置。" };
  }
  return {
    ok: true,
    payload: mergeFullRows(payload.data, fullRows.data),
    presentation,
    exportResource: resource.data ?? null,
  };
}

/** 个体记录只认 App 私有 `_meta`；structuredContent/content 即使出现同名字段也不读取。 */
export function deliverRecordProjection(result: ToolResult): DeliveredRecords {
  if (result.isError) {
    return { ok: false, error: firstText(result.content) ?? "构成记录加载失败。" };
  }
  const parsed = RECORD_PROJECTION_PAYLOAD_SCHEMA.safeParse(
    result._meta?.[RECORD_PROJECTION_META_KEY],
  );
  return parsed.success
    ? { ok: true, payload: parsed.data }
    : { ok: false, error: "构成记录缺少有效的受控记录载荷。" };
}
