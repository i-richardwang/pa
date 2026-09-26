/**
 * 结果卡和名单卡共用的宿主逻辑：状态存储、App 握手、宿主上下文（深浅色与展示模式）、
 * 全屏请求和连接失败提示。载荷字段和工具名放在各自的 host 文件里。
 */
import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useSyncExternalStore } from "react";
import { PRODUCT_VERSION, RESULT_WIDGET_NAME } from "@product";

/** 每张卡片状态都包含的宿主字段，取值来自宿主上下文。 */
export type HostShellState = {
  displayMode: string;
  canFullscreen: boolean;
};

export const HOST_SHELL_INITIAL: HostShellState = { displayMode: "inline", canFullscreen: false };

export type HostStore<S> = {
  get: () => S;
  set: (patch: Partial<S>) => void;
  /** 供 React 组件订阅（useSyncExternalStore）。 */
  use: () => S;
  /** 宿主关闭视图时清空订阅。 */
  clear: () => void;
};

export function createHostStore<S>(initial: S): HostStore<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  const subscribe = (notify: () => void) => {
    listeners.add(notify);
    return () => listeners.delete(notify);
  };
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const notify of listeners) notify();
    },
    use: () => useSyncExternalStore(subscribe, () => state),
    clear: () => listeners.clear(),
  };
}

/** 两张卡都声明 inline 和 fullscreen 两种展示模式；名单卡的名称带 `-records` 后缀。 */
export function createHostApp(nameSuffix = ""): App {
  return new App(
    { name: `${RESULT_WIDGET_NAME}${nameSuffix}`, version: PRODUCT_VERSION },
    { availableDisplayModes: ["inline", "fullscreen"] },
  );
}

/** 只跟随宿主的深浅色，不使用宿主的调色变量（applyHostStyleVariables）。 */
export function applyHostContext<S extends HostShellState>(
  store: HostStore<S>,
  ctx: McpUiHostContext | undefined,
): void {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  const current = store.get();
  store.set({
    displayMode: ctx.displayMode ?? current.displayMode,
    canFullscreen: ctx.availableDisplayModes
      ? ctx.availableDisplayModes.includes("fullscreen")
      : current.canFullscreen,
  } as Partial<S>);
}

export async function requestFullscreen<S extends HostShellState>(
  app: App,
  store: HostStore<S>,
): Promise<void> {
  const result = await app.requestDisplayMode({ mode: "fullscreen" });
  // 部分宿主不会发送 hostcontextchanged，所以先按响应更新
  store.set({ displayMode: result.mode } as Partial<S>);
  if (result.mode !== "fullscreen") throw new Error("无法切换到全屏。");
}

export function connectFailure(error: unknown): string {
  return `无法连接到 MCP 客户端：${error instanceof Error ? error.message : String(error)}`;
}
