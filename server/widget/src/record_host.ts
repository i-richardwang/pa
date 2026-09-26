/**
 * 名单卡与宿主的连接：view_id 来自工具输入，明细记录来自工具结果的私有 `_meta`；
 * 翻页时由卡片调用 load_records_page。
 */
import type { RecordProjectionPayload } from "@records";
import {
  viewIdFrom,
  deliverRecordProjection,
  firstText,
  type ToolResult,
} from "./result_delivery.js";
import {
  applyHostContext,
  connectFailure,
  createHostApp,
  createHostStore,
  HOST_SHELL_INITIAL,
  type HostShellState,
  requestFullscreen as requestShellFullscreen,
} from "./host_shell.js";
import { createRequestCoordinator } from "./request_coordinator.js";

export type RecordHostState = HostShellState & {
  viewId: string | null;
  payload: RecordProjectionPayload | null;
  status: string;
  loading: boolean;
};

export const RECORDS_WAITING_STATUS = "正在加载构成记录…";

const store = createHostStore<RecordHostState>({
  ...HOST_SHELL_INITIAL,
  viewId: null,
  payload: null,
  status: RECORDS_WAITING_STATUS,
  loading: true,
});

export const useRecordHostState = store.use;

const app = createHostApp("-records");
const requests = createRequestCoordinator();

function applyResult(result: ToolResult): boolean {
  const delivered = deliverRecordProjection(result);
  if (!delivered.ok) {
    store.set({ status: delivered.error, loading: false });
    return false;
  }
  const viewId = viewIdFrom(result.structuredContent) ?? store.get().viewId;
  store.set({ viewId, payload: delivered.payload, status: "", loading: false });
  return true;
}

export async function loadRecordPage(offset: number): Promise<void> {
  const { viewId, payload, loading } = store.get();
  if (!viewId || !payload || loading) return;
  const token = requests.begin();
  if (token === null) return;
  store.set({ loading: true, status: "正在加载名单…" });
  try {
    const result = (await app.callServerTool({
      name: "load_records_page",
      arguments: {
        view_id: viewId,
        metric_id: payload.metric_id,
        data_as_of: payload.data_as_of,
        offset,
        limit: payload.page_size,
      },
    })) as ToolResult;
    if (requests.isCurrent(token)) applyResult(result);
  } catch (error) {
    if (!requests.isCurrent(token)) return;
    store.set({
      loading: false,
      status: `名单加载失败：${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export const requestRecordFullscreen = (): Promise<void> => requestShellFullscreen(app, store);

export async function connectRecordHost(): Promise<void> {
  app.onteardown = async () => {
    requests.close();
    store.clear();
    return {};
  };
  app.addEventListener("toolinput", (params) => {
    requests.invalidate();
    store.set({
      viewId: viewIdFrom(params.arguments) ?? store.get().viewId,
      status: RECORDS_WAITING_STATUS,
      loading: true,
    });
  });
  app.addEventListener("toolresult", (params) => {
    const result = params as ToolResult;
    if (result.isError) {
      store.set({
        status: firstText(result.content) ?? "无法打开构成记录。",
        loading: false,
      });
      return;
    }
    applyResult(result);
  });
  app.addEventListener("toolcancelled", () => {
    if (!store.get().payload) store.set({ status: "名单查询已取消。", loading: false });
  });
  app.addEventListener("hostcontextchanged", (ctx) => applyHostContext(store, ctx));
  try {
    await app.connect();
    applyHostContext(store, app.getHostContext());
  } catch (error) {
    store.set({ payload: null, loading: false, status: connectFailure(error) });
  }
}
