/**
 * 浮层撤下：判据与订阅。
 *
 * 钉住的浮层会留在原地等人，故要有一条明确的撤下策略——Esc，或按在它所在那一块之外。
 * 两条合成一条，各浮层不再各写一遍；宿主对象由调用方交进来（与 `observeElementSize`、
 * `watchTheme` 同式），策略与订阅因此都跑得出用例，不必先支起一个 DOM。
 */
import { useEffect, useRef, type RefObject } from "react";

/** 判定用得上的那几个字段：真事件与存根都喂得进来。 */
export type DismissEvent = { type: string; key?: string; target?: unknown };

type DismissHandler = (event: DismissEvent) => void;

export type DismissHost = {
  addEventListener(type: string, handler: DismissHandler): void;
  removeEventListener(type: string, handler: DismissHandler): void;
};

/** 落在这一块之内的按下不算「按在外面」；块还没挂上时，按哪儿都算外面。 */
function dismisses(
  event: DismissEvent,
  within: { contains(node: Node): boolean } | null,
): boolean {
  if (event.type === "keydown") return event.key === "Escape";
  return !within || !within.contains(event.target as Node);
}

/** 两种事件同一个处理器：判据自己按 `type` 分岔，订阅这一层不重复那道分支。 */
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
 * 钉住期间才订阅：没钉住的浮层没有「撤下」这回事。
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
    return watchDismiss(document, () => within.current, () => latest.current());
  }, [active, within]);
}
