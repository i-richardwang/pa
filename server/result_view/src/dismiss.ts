/** 按 Esc 或在元素外按下鼠标时关闭；事件源由调用方传入。 */
import { useEffect, useRef, type RefObject } from "react";

export type DismissEvent = { type: string; key?: string; target?: unknown };

type DismissHandler = (event: DismissEvent) => void;

export type DismissHost = {
  addEventListener(type: string, handler: DismissHandler): void;
  removeEventListener(type: string, handler: DismissHandler): void;
};

/** 在元素内按下不关闭；元素尚未挂载时，任何位置按下都关闭。 */
function dismisses(event: DismissEvent, within: { contains(node: Node): boolean } | null): boolean {
  if (event.type === "keydown") return event.key === "Escape";
  return !within || !within.contains(event.target as Node);
}

export function watchDismiss(
  host: DismissHost,
  within: () => { contains(node: Node): boolean } | null,
  onDismiss: () => void,
): () => void {
  const handle: DismissHandler = (event) => {
    if (dismisses(event, within())) onDismiss();
  };
  host.addEventListener("keydown", handle);
  host.addEventListener("mousedown", handle);
  return () => {
    host.removeEventListener("keydown", handle);
    host.removeEventListener("mousedown", handle);
  };
}

/** 回调存进 ref：调用处通常每次渲染都传入新闭包，放进依赖会导致每次渲染都重新订阅。 */
export function useDismiss(
  active: boolean,
  within: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  useEffect(() => {
    if (!active) return;
    return watchDismiss(
      document,
      () => within.current,
      () => latest.current(),
    );
  }, [active, within]);
}
