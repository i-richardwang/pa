import { analysisIdFrom, type ToolResult } from "./result_delivery.js";

export type AnalysisLoaderPort = {
  call(analysisId: string): Promise<ToolResult>;
  apply(result: ToolResult): boolean;
  waiting(): void;
  fail(message: string): void;
};

/**
 * 结果卡的数据加载状态机：tool input 可先于握手到达，重复的 input/result 通知只触发一次加载，
 * 新句柄到达时旧请求结果不得覆盖当前卡片。
 */
export function createAnalysisLoader(port: AnalysisLoaderPort) {
  let connected = false;
  let closed = false;
  let pendingAnalysisId: string | null = null;
  let loadedAnalysisId: string | null = null;
  const loading = new Set<string>();

  async function load(analysisId: string): Promise<void> {
    if (closed || !connected || loading.has(analysisId) || loadedAnalysisId === analysisId) {
      return;
    }
    loading.add(analysisId);
    port.waiting();
    try {
      const result = await port.call(analysisId);
      if (closed || pendingAnalysisId !== analysisId) return;
      if (port.apply(result)) loadedAnalysisId = analysisId;
    } catch (error) {
      if (closed || pendingAnalysisId !== analysisId) return;
      port.fail(`无法加载分析结果：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      loading.delete(analysisId);
    }
  }

  function receive(value: unknown): void {
    const analysisId = analysisIdFrom(value);
    if (!analysisId) {
      if (!pendingAnalysisId) port.fail("结果卡缺少有效的 analysis_id。");
      return;
    }
    pendingAnalysisId = analysisId;
    void load(analysisId);
  }

  async function connect(): Promise<void> {
    if (closed) return;
    connected = true;
    if (pendingAnalysisId) await load(pendingAnalysisId);
  }

  function close(): void {
    closed = true;
    connected = false;
  }

  return { receive, connect, close };
}
