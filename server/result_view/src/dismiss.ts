/** 撤下 = Esc 或按在块外；宿主由调用方注入。 */
import { useEffect, useRef, type RefObject } from "react";

export type DismissEvent = { type: string; key?: string; target?: unknown };

type DismissHandler = (event: DismissEvent) => void;

export type DismissHost = {
  addEventListener(type: string, handler: DismissHandler): void;
  removeEventListener(type: string, handler: DismissHandler): void;
};

/** 落在这一块之内的按下不算「按在外面」；块还没挂上时，按哪儿都算外面。 */
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

/**
 * 回调存进 ref 再读——它多半是调用处现写的闭包，直接进依赖会让每帧都退订重订。
 */
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
