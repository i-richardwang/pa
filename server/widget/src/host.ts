/**
 * 结果卡宿主接线：show_analysis 的 tool input 只交付 view_id；App 完成握手后调用
 * load_analysis_card，消费其 structuredContent 与不进模型上下文的 `_meta` 全量行块。
 * React 组件经 useHostState 消费合并后的 QueryPayload。
 * 卡片上限截断走 export 限时票据；仅当宿主支持标准下载时
 * 才提交 _meta 中的 resource_link，外链与剪贴板不作为结果卡的导出退路。
 */
import { deliverExport, resolveExportDelivery, type ExportDelivery } from "./host_actions.js";
import type { PresentationBlock } from "@charts";
import type { ExportResourceLink, QueryPayload } from "@payload";
import { deliverAnalysisResult, firstText, type ToolResult } from "./result_delivery.js";
import { createAnalysisLoader } from "./analysis_loader.js";
import {
  applyHostContext,
  connectFailure,
  createHostApp,
  createHostStore,
  HOST_SHELL_INITIAL,
  type HostShellState,
  requestFullscreen as requestShellFullscreen,
} from "./host_shell.js";

export type HostState = HostShellState & {
  payload: QueryPayload | null;
  /** 服务端完整呈现配置，仅经 _meta 交付。 */
  presentation: PresentationBlock | null;
  exportResource: ExportResourceLink | null;
  /** payload 为空时显示的状态文案（等待/错误/取消） */
  status: string;
  exportDelivery: ExportDelivery | null;
};

export const WAITING_STATUS = "等待查询结果…";

const EMPTY_RESULT = {
  payload: null,
  presentation: null,
  exportResource: null,
  exportDelivery: null,
} satisfies Partial<HostState>;

const store = createHostStore<HostState>({
  ...HOST_SHELL_INITIAL,
  ...EMPTY_RESULT,
  status: WAITING_STATUS,
});

export const useHostState = store.use;

const app = createHostApp();

function applyResult(result: ToolResult): boolean {
  const delivered = deliverAnalysisResult(result);
  if (!delivered.ok) {
    store.set({ ...EMPTY_RESULT, status: delivered.error });
    return false;
  }
  store.set({
    payload: delivered.payload,
    presentation: delivered.presentation,
    exportResource: delivered.exportResource,
    exportDelivery: resolveExportDelivery(app, delivered.exportResource ?? undefined) ?? null,
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
  waiting: () => store.set({ ...EMPTY_RESULT, status: WAITING_STATUS }),
  fail: (status) => store.set({ ...EMPTY_RESULT, status }),
});

export const requestFullscreen = (): Promise<void> => requestShellFullscreen(app, store);

/** 执行宿主已经明确声明支持的标准文件下载。 */
export async function runExport(resource: ExportResourceLink | null): Promise<void> {
  await deliverExport(app, resource ?? undefined);
}

export async function connectHost(): Promise<void> {
  // MCP Apps 约定 teardown handler 必须在 connect 前注册，宿主关闭视图时可等待清理完成。
  app.onteardown = async () => {
    analysisLoader.close();
    store.clear();
    return {};
  };
  app.addEventListener("toolinput", (params) => analysisLoader.receive(params.arguments));
  app.addEventListener("toolresult", (params) => {
    const result = params as ToolResult;
    if (result.isError && !store.get().payload) {
      store.set({ status: firstText(result.content) ?? "无法打开分析结果卡。" });
      return;
    }
    analysisLoader.receive(result.structuredContent);
  });
  app.addEventListener("toolcancelled", () => {
    if (!store.get().payload) store.set({ status: "查询已取消。" });
  });
  app.addEventListener("hostcontextchanged", (ctx) => applyHostContext(store, ctx));
  try {
    await app.connect();
    applyHostContext(store, app.getHostContext());
    store.set({
      exportDelivery: resolveExportDelivery(app, store.get().exportResource ?? undefined) ?? null,
    });
    await analysisLoader.connect();
  } catch (error) {
    store.set({ ...EMPTY_RESULT, status: connectFailure(error) });
  }
}
