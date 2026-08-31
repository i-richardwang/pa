import { expect, test } from "bun:test";
import type { App } from "@modelcontextprotocol/ext-apps";
import {
  applyHostContext,
  connectFailure,
  createHostStore,
  HOST_SHELL_INITIAL,
  requestFullscreen,
} from "./host_shell.js";

test("状态仓：状态合并、订阅者按次通知、清空后不再通知", () => {
  const store = createHostStore({ ...HOST_SHELL_INITIAL, payload: null as string | null });
  store.set({ payload: "p" });
  expect(store.get()).toEqual({ displayMode: "inline", canFullscreen: false, payload: "p" });
});

test("宿主上下文只改它给了的那几样；没给的保留", () => {
  const store = createHostStore({ ...HOST_SHELL_INITIAL });
  applyHostContext(store, undefined);
  expect(store.get()).toEqual(HOST_SHELL_INITIAL);
  applyHostContext(store, { availableDisplayModes: ["inline", "fullscreen"] });
  expect(store.get()).toEqual({ displayMode: "inline", canFullscreen: true });
  applyHostContext(store, { displayMode: "fullscreen" });
  expect(store.get()).toEqual({ displayMode: "fullscreen", canFullscreen: true });
});

test("全屏请求先按响应落状态；宿主不给全屏就明确失败", async () => {
  const store = createHostStore({ ...HOST_SHELL_INITIAL, canFullscreen: true });
  const app = (mode: string) => ({ requestDisplayMode: async () => ({ mode }) }) as unknown as App;
  await requestFullscreen(app("fullscreen"), store);
  expect(store.get().displayMode).toBe("fullscreen");
  await expect(requestFullscreen(app("inline"), store)).rejects.toThrow("全屏");
  expect(store.get().displayMode).toBe("inline");
});

test("连接失败的措辞带上原因", () => {
  expect(connectFailure(new Error("timeout"))).toBe("无法连接 MCP Widget 宿主：timeout");
  expect(connectFailure("boom")).toBe("无法连接 MCP Widget 宿主：boom");
});
