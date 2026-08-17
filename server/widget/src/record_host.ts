import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useSyncExternalStore } from "react";
import { PRODUCT_VERSION, RESULT_WIDGET_NAME } from "@product";
import type { RecordProjectionPayload } from "@records";
import {
  analysisIdFrom,
  deliverRecordProjection,
  firstText,
  type ToolResult,
} from "./result_delivery.js";

export type RecordHostState = {
  analysisId: string | null;
  payload: RecordProjectionPayload | null;
  status: string;
  loading: boolean;
  displayMode: string;
  canFullscreen: boolean;
};

export const RECORDS_WAITING_STATUS = "正在加载人员名单…";

let state: RecordHostState = {
  analysisId: null,
  payload: null,
  status: RECORDS_WAITING_STATUS,
  loading: true,
  displayMode: "inline",
  canFullscreen: false,
};
const listeners = new Set<() => void>();

function setState(patch: Partial<RecordHostState>): void {
  state = { ...state, ...patch };
  for (const notify of listeners) notify();
}

export function useRecordHostState(): RecordHostState {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => state,
  );
}

const app = new App(
  { name: `${RESULT_WIDGET_NAME}-records`, version: PRODUCT_VERSION },
  { availableDisplayModes: ["inline", "fullscreen"] },
);

function applyResult(result: ToolResult): boolean {
  const delivered = deliverRecordProjection(result);
  if (!delivered.ok) {
    setState({ status: delivered.error, loading: false });
    return false;
  }
  const analysisId = analysisIdFrom(result.structuredContent) ?? state.analysisId;
  setState({ analysisId, payload: delivered.payload, status: "", loading: false });
  return true;
}

function applyHostContext(ctx: McpUiHostContext | undefined): void {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  setState({
    displayMode: ctx.displayMode ?? state.displayMode,
    canFullscreen: ctx.availableDisplayModes
      ? ctx.availableDisplayModes.includes("fullscreen")
      : state.canFullscreen,
  });
}

export async function loadRecordPage(offset: number): Promise<void> {
  const { analysisId, payload } = state;
  if (!analysisId || !payload || state.loading) return;
  setState({ loading: true, status: "正在加载名单分页…" });
  try {
    const result = (await app.callServerTool({
      name: "load_records_page",
      arguments: {
        analysis_id: analysisId,
        metric_id: payload.metric_id,
        data_as_of: payload.data_as_of,
        offset,
        limit: payload.page_size,
      },
    })) as ToolResult;
    applyResult(result);
  } catch (error) {
    setState({
      loading: false,
      status: `名单分页加载失败：${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function requestRecordFullscreen(): Promise<void> {
  const result = await app.requestDisplayMode({ mode: "fullscreen" });
  setState({ displayMode: result.mode });
  if (result.mode !== "fullscreen") throw new Error("宿主未切换到全屏模式。");
}

export async function connectRecordHost(): Promise<void> {
  app.onteardown = async () => {
    listeners.clear();
    return {};
  };
  app.addEventListener("toolinput", (params) => {
    setState({
      analysisId: analysisIdFrom(params.arguments) ?? state.analysisId,
      status: RECORDS_WAITING_STATUS,
      loading: true,
    });
  });
  app.addEventListener("toolresult", (params) => {
    const result = params as ToolResult;
    if (result.isError) {
      setState({
        status: firstText(result.content) ?? "无法打开人员名单。",
        loading: false,
      });
      return;
    }
    applyResult(result);
  });
  app.addEventListener("toolcancelled", () => {
    if (!state.payload) setState({ status: "名单查询已取消。", loading: false });
  });
  app.addEventListener("hostcontextchanged", (ctx) => applyHostContext(ctx));
  try {
    await app.connect();
    applyHostContext(app.getHostContext());
  } catch (error) {
    setState({
      payload: null,
      loading: false,
      status: `无法连接预览宿主：${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
