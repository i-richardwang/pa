import { isPresentationBlock, PRESENTATION_META_KEY, type PresentationBlock } from "@charts";
import {
  EXPORT_RESOURCE_META_KEY,
  FULL_ROWS_META_KEY,
  isExportResourceLink,
  isFullRowsBlock,
  isQueryPayload,
  mergeFullRows,
  type ExportResourceLink,
  type FullRowsBlock,
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

/**
 * App 只接受 MCP 的结构化结果通道。content 是面向模型/用户的文本退路，
 * 不承担 iframe 数据协议，也不尝试从宿主包装文本中恢复 JSON。
 */
export function deliverAnalysisResult(result: ToolResult): DeliveredAnalysis {
  if (result.isError) {
    return { ok: false, error: firstText(result.content) ?? "查询失败。" };
  }
  if (result.structuredContent === undefined) {
    return { ok: false, error: "查询结果缺少结构化载荷。" };
  }
  if (!isQueryPayload(result.structuredContent)) {
    return { ok: false, error: "查询结果不符合预览载荷契约。" };
  }

  const payload = result.structuredContent;
  const fullCandidate = result._meta?.[FULL_ROWS_META_KEY];
  if (fullCandidate !== undefined && !isFullRowsBlock(fullCandidate, payload)) {
    return { ok: false, error: "查询结果的全量行数据格式无效。" };
  }
  const resourceCandidate = result._meta?.[EXPORT_RESOURCE_META_KEY];
  if (resourceCandidate !== undefined && !isExportResourceLink(resourceCandidate)) {
    return { ok: false, error: "查询结果的下载资源格式无效。" };
  }

  const presentationCandidate = result._meta?.[PRESENTATION_META_KEY];
  if (!isPresentationBlock(presentationCandidate)) {
    return { ok: false, error: "查询结果缺少有效的服务端呈现配置。" };
  }
  const fullRows = fullCandidate as FullRowsBlock | undefined;
  const exportResource = (resourceCandidate as ExportResourceLink | undefined) ?? null;
  return {
    ok: true,
    payload: mergeFullRows(payload, fullRows),
    presentation: presentationCandidate,
    exportResource,
  };
}

/** 个体记录只认 App 私有 `_meta`；structuredContent/content 即使出现同名字段也不读取。 */
export function deliverRecordProjection(result: ToolResult): DeliveredRecords {
  if (result.isError) {
    return { ok: false, error: firstText(result.content) ?? "人员名单加载失败。" };
  }
  const parsed = RECORD_PROJECTION_PAYLOAD_SCHEMA.safeParse(
    result._meta?.[RECORD_PROJECTION_META_KEY],
  );
  return parsed.success
    ? { ok: true, payload: parsed.data }
    : { ok: false, error: "人员名单缺少有效的受控记录载荷。" };
}
