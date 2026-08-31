import { viewIdFrom, type ToolResult } from "./result_delivery.js";
import { createRequestCoordinator } from "./request_coordinator.js";

export type AnalysisLoaderPort = {
  call(viewId: string): Promise<ToolResult>;
  apply(result: ToolResult): boolean;
  waiting(): void;
  fail(message: string): void;
};

/**
 * 结果卡的数据加载状态机：tool input 可先于握手到达，重复的 input/result 通知只触发一次加载，
 * view_id 变化后，非当前请求的结果不得覆盖当前卡片。
 */
export function createAnalysisLoader(port: AnalysisLoaderPort) {
  let connected = false;
  const requests = createRequestCoordinator();
  let pendingViewId: string | null = null;
  let loadedViewId: string | null = null;
  const loading = new Set<string>();

  async function load(viewId: string): Promise<void> {
    if (requests.isClosed() || !connected || loading.has(viewId) || loadedViewId === viewId) {
      return;
    }
    const token = requests.begin();
    if (token === null) return;
    loading.add(viewId);
    port.waiting();
    try {
      const result = await port.call(viewId);
      if (!requests.isCurrent(token) || pendingViewId !== viewId) return;
      if (port.apply(result)) loadedViewId = viewId;
    } catch (error) {
      if (!requests.isCurrent(token) || pendingViewId !== viewId) return;
      port.fail(`无法加载分析结果：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      loading.delete(viewId);
    }
  }

  function receive(value: unknown): void {
    const viewId = viewIdFrom(value);
    if (!viewId) {
      if (!pendingViewId) port.fail("结果卡缺少有效的 view_id。");
      return;
    }
    if (pendingViewId !== viewId) requests.invalidate();
    pendingViewId = viewId;
    void load(viewId);
  }

  async function connect(): Promise<void> {
    if (requests.isClosed()) return;
    connected = true;
    if (pendingViewId) await load(pendingViewId);
  }

  function close(): void {
    requests.close();
    connected = false;
  }

  return { receive, connect, close };
}
