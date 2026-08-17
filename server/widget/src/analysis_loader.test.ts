import { describe, expect, test } from "bun:test";
import { createAnalysisLoader, type AnalysisLoaderPort } from "./analysis_loader.js";
import type { ToolResult } from "./result_delivery.js";

const FIRST_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_ID = "33333333-3333-4333-8333-333333333333";

function harness(overrides: Partial<AnalysisLoaderPort> = {}) {
  const calls: string[] = [];
  const applied: ToolResult[] = [];
  const failures: string[] = [];
  let waiting = 0;
  const port: AnalysisLoaderPort = {
    call: async (analysisId) => {
      calls.push(analysisId);
      return { structuredContent: { analysis_id: analysisId } };
    },
    apply: (result) => {
      applied.push(result);
      return true;
    },
    waiting: () => {
      waiting += 1;
    },
    fail: (message) => failures.push(message),
    ...overrides,
  };
  return {
    loader: createAnalysisLoader(port),
    calls,
    applied,
    failures,
    waiting: () => waiting,
  };
}

describe("analysis loader", () => {
  test("缓存握手前的 tool input，连接后只加载一次", async () => {
    const state = harness();
    state.loader.receive({ analysis_id: FIRST_ID });
    expect(state.calls).toEqual([]);

    await state.loader.connect();
    expect(state.calls).toEqual([FIRST_ID]);
    expect(state.applied).toHaveLength(1);
    expect(state.waiting()).toBe(1);

    state.loader.receive({ analysis_id: FIRST_ID });
    await Promise.resolve();
    expect(state.calls).toEqual([FIRST_ID]);
  });

  test("新句柄到达后加载新结果，旧句柄不会阻塞", async () => {
    const state = harness();
    await state.loader.connect();
    state.loader.receive({ analysis_id: FIRST_ID });
    await Promise.resolve();
    state.loader.receive({ analysis_id: SECOND_ID });
    await Promise.resolve();

    expect(state.calls).toEqual([FIRST_ID, SECOND_ID]);
    expect(state.applied).toHaveLength(2);
  });

  test("输入和宿主代理错误使用稳定状态文案", async () => {
    const invalid = harness();
    invalid.loader.receive({ analysis_id: "not-a-uuid" });
    expect(invalid.failures).toEqual(["结果卡缺少有效的 analysis_id。"]);

    const failed = harness({
      call: async () => {
        throw new Error("host proxy unavailable");
      },
    });
    await failed.loader.connect();
    failed.loader.receive({ analysis_id: FIRST_ID });
    await Promise.resolve();
    await Promise.resolve();
    expect(failed.failures).toEqual(["无法加载分析结果：host proxy unavailable"]);
  });

  test("关闭后未完成请求不得回写卡片", async () => {
    let resolveResult: ((result: ToolResult) => void) | undefined;
    const state = harness({
      call: () =>
        new Promise<ToolResult>((resolve) => {
          resolveResult = resolve;
        }),
    });
    await state.loader.connect();
    state.loader.receive({ analysis_id: FIRST_ID });
    await Promise.resolve();
    state.loader.close();
    resolveResult?.({ structuredContent: { analysis_id: FIRST_ID } });
    await Promise.resolve();

    expect(state.applied).toEqual([]);
  });
});
