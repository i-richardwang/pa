import { expect, test } from "bun:test";
import type { App } from "@modelcontextprotocol/ext-apps";
import {
  applyHostContext,
  connectFailure,
  createHostStore,
  HOST_SHELL_INITIAL,
  requestFullscreen,
} from "./host_shell.js";

test("状态存储合并部分更新", () => {
  const store = createHostStore({ ...HOST_SHELL_INITIAL, payload: null as string | null });
  store.set({ payload: "p" });
  expect(store.get()).toEqual({ displayMode: "inline", canFullscreen: false, payload: "p" });
});

test("宿主上下文只更新它提供的字段，其余字段保持不变", () => {
  const store = createHostStore({ ...HOST_SHELL_INITIAL });
  applyHostContext(store, undefined);
  expect(store.get()).toEqual(HOST_SHELL_INITIAL);
  applyHostContext(store, { availableDisplayModes: ["inline", "fullscreen"] });
  expect(store.get()).toEqual({ displayMode: "inline", canFullscreen: true });
  applyHostContext(store, { displayMode: "fullscreen" });
  expect(store.get()).toEqual({ displayMode: "fullscreen", canFullscreen: true });
});

test("全屏请求先按宿主响应更新状态；宿主未切到全屏时抛错", async () => {
  const store = createHostStore({ ...HOST_SHELL_INITIAL, canFullscreen: true });
  const app = (mode: string) => ({ requestDisplayMode: async () => ({ mode }) }) as unknown as App;
  await requestFullscreen(app("fullscreen"), store);
  expect(store.get().displayMode).toBe("fullscreen");
  await expect(requestFullscreen(app("inline"), store)).rejects.toThrow("全屏");
  expect(store.get().displayMode).toBe("inline");
});

test("连接失败提示包含错误原因", () => {
  expect(connectFailure(new Error("timeout"))).toBe("无法连接到 MCP 客户端：timeout");
  expect(connectFailure("boom")).toBe("无法连接到 MCP 客户端：boom");
});
