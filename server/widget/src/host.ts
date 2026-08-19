/**
 * 宿主接线：show_analysis 的 tool input 只交付 view_id；App 完成握手后调用
 * load_analysis_card，消费其 structuredContent 与不进模型上下文的 `_meta` 全量行块。
 * React 组件经 useHostState 消费合并后的 QueryPayload。
 * 卡片上限截断走 export 限时票据；仅当宿主支持标准下载时
 * 才提交 _meta 中的 resource_link，外链与剪贴板不作为 Preview 导出退路。
 */
import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useSyncExternalStore } from "react";
import { PRODUCT_VERSION, RESULT_WIDGET_NAME } from "@product";
import { deliverExport, resolveExportDelivery, type ExportDelivery } from "./host_actions.js";
import type { PresentationBlock } from "@charts";
import type { ExportResourceLink, QueryPayload } from "@payload";
import { deliverAnalysisResult, firstText, type ToolResult } from "./result_delivery.js";
import { createAnalysisLoader } from "./analysis_loader.js";

export type HostState = {
  payload: QueryPayload | null;
  /** 服务端完整呈现配置，仅经 _meta 交付。 */
  presentation: PresentationBlock | null;
  exportResource: ExportResourceLink | null;
  /** payload 为空时显示的状态文案（等待/错误/取消） */
  status: string;
  displayMode: string;
  canFullscreen: boolean;
  exportDelivery: ExportDelivery | null;
};

export const WAITING_STATUS = "等待查询结果…";

let state: HostState = {
  payload: null,
  presentation: null,
  exportResource: null,
  status: WAITING_STATUS,
  displayMode: "inline",
  canFullscreen: false,
  exportDelivery: null,
};
const listeners = new Set<() => void>();

function setState(patch: Partial<HostState>): void {
  state = { ...state, ...patch };
  for (const notify of listeners) notify();
}

export function useHostState(): HostState {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => state,
  );
}

const app = new App(
  { name: RESULT_WIDGET_NAME, version: PRODUCT_VERSION },
  { availableDisplayModes: ["inline", "fullscreen"] },
);

function applyResult(result: ToolResult): boolean {
  const delivered = deliverAnalysisResult(result);
  if (!delivered.ok) {
    setState({
      payload: null,
      presentation: null,
      exportResource: null,
      exportDelivery: null,
      status: delivered.error,
    });
    return false;
  }
  setState({
    payload: delivered.payload,
    presentation: delivered.presentation,
    exportResource: delivered.exportResource,
    exportDelivery: resolveExportDelivery(app, delivered.exportResource ?? undefined) ?? null,
    status: state.status,
  });
  return true;
}

const analysisLoader = createAnalysisLoader({
  call: async (viewId) =>
    (await app.callServerTool({
      name: "load_analysis_card",
      arguments: { view_id: viewId },
    })) as ToolResult,
  apply: applyResult,
  waiting: () =>
    setState({
      payload: null,
      presentation: null,
      exportResource: null,
      exportDelivery: null,
      status: WAITING_STATUS,
    }),
  fail: (status) =>
    setState({
      payload: null,
      presentation: null,
      exportResource: null,
      exportDelivery: null,
      status,
    }),
});

function applyHostContext(ctx: McpUiHostContext | undefined): void {
  if (!ctx) return;
  // 只随宿主明暗，不吃宿主调色变量（applyHostStyleVariables）；配色定义见 styles.css 头注。
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  setState({
    displayMode: ctx.displayMode ?? state.displayMode,
    canFullscreen: ctx.availableDisplayModes
      ? ctx.availableDisplayModes.includes("fullscreen")
      : state.canFullscreen,
  });
}

export async function requestFullscreen(): Promise<void> {
  const result = await app.requestDisplayMode({ mode: "fullscreen" });
  // 宿主应另发 hostcontextchanged；先应用响应可避免宽松宿主漏通知时状态滞后。
  setState({ displayMode: result.mode });
  if (result.mode !== "fullscreen") throw new Error("宿主未切换到全屏模式。");
}

/** 执行宿主已经明确声明支持的标准文件下载。 */
export async function runExport(resource?: ExportResourceLink): Promise<void> {
  await deliverExport(app, resource);
}

export async function connectHost(): Promise<void> {
  // MCP Apps 约定 teardown handler 必须在 connect 前注册，宿主关闭视图时可等待清理完成。
  app.onteardown = async () => {
    analysisLoader.close();
    listeners.clear();
    return {};
  };
  app.addEventListener("toolinput", (params) => analysisLoader.receive(params.arguments));
  app.addEventListener("toolresult", (params) => {
    const result = params as ToolResult;
    if (result.isError && !state.payload) {
      setState({ status: firstText(result.content) ?? "无法打开分析结果卡。" });
      return;
    }
    analysisLoader.receive(result.structuredContent);
  });
  app.addEventListener("toolcancelled", () => {
    if (!state.payload) setState({ status: "查询已取消。" });
  });
  app.addEventListener("hostcontextchanged", (ctx) => applyHostContext(ctx));
  try {
    await app.connect();
    applyHostContext(app.getHostContext());
    setState({
      exportDelivery: resolveExportDelivery(app, state.exportResource ?? undefined) ?? null,
    });
    await analysisLoader.connect();
  } catch (error) {
    setState({
      payload: null,
      exportResource: null,
      exportDelivery: null,
      status: `无法连接预览宿主：${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
