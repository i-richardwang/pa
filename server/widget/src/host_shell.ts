/**
 * MCP Widget 宿主的公共壳：两张卡（结果卡、名单卡）各有自己的载荷与工具调用，
 * 但状态仓、App 握手、宿主上下文（明暗与展示模式）、全屏请求与连接失败的措辞是同一套。
 * 本文件只放这一套；载荷相关的状态字段与工具名留在各自的 host。
 */
import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useSyncExternalStore } from "react";
import { PRODUCT_VERSION, RESULT_WIDGET_NAME } from "@product";

/** 每张卡的状态都带的宿主面：展示模式与能否全屏由宿主上下文给。 */
export type HostShellState = {
  displayMode: string;
  canFullscreen: boolean;
};

export const HOST_SHELL_INITIAL: HostShellState = { displayMode: "inline", canFullscreen: false };

export type HostStore<S> = {
  get: () => S;
  set: (patch: Partial<S>) => void;
  /** React 侧订阅：useSyncExternalStore 绑定到这一个仓。 */
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

/** 两张卡都声明 inline 与 fullscreen 两档展示模式；名单卡在产品名后缀 `-records`。 */
export function createHostApp(nameSuffix = ""): App {
  return new App(
    { name: `${RESULT_WIDGET_NAME}${nameSuffix}`, version: PRODUCT_VERSION },
    { availableDisplayModes: ["inline", "fullscreen"] },
  );
}

/** 只随宿主明暗，不吃宿主调色变量（applyHostStyleVariables）；配色定义见 styles.css 头注。 */
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
  // 宿主应另发 hostcontextchanged；先应用响应可避免宽松宿主漏通知时状态滞后。
  store.set({ displayMode: result.mode } as Partial<S>);
  if (result.mode !== "fullscreen") throw new Error("宿主未切换到全屏模式。");
}

export function connectFailure(error: unknown): string {
  return `无法连接 MCP Widget 宿主：${error instanceof Error ? error.message : String(error)}`;
}
