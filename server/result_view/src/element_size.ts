import { useCallback, useRef, useState } from "react";

export type ElementSize = { width: number; height: number };

type Watch = { size: ElementSize; callbacks: Set<(size: ElementSize) => void> };

const watched = new Map<Element, Watch>();
let observer: ResizeObserver | null = null;

function measure(element: Element): ElementSize {
  const rect = element.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function moved(previous: ElementSize, next: ElementSize): boolean {
  return Math.abs(previous.width - next.width) >= 1 || Math.abs(previous.height - next.height) >= 1;
}

function dispatch(entries: ResizeObserverEntry[]): void {
  for (const entry of entries) {
    const watch = watched.get(entry.target);
    if (!watch) continue;
    const box = entry.borderBoxSize?.[0];
    const size = box ? { width: box.inlineSize, height: box.blockSize } : measure(entry.target);
    if (!moved(watch.size, size)) continue;
    watch.size = size;
    for (const callback of watch.callbacks) callback(size);
  }
}

export function observeElementSize(
  element: Element,
  callback: (size: ElementSize) => void,
): () => void {
  observer ??= new ResizeObserver(dispatch);
  let watch = watched.get(element);
  if (!watch) {
    watch = { size: measure(element), callbacks: new Set() };
    watched.set(element, watch);
    observer.observe(element);
  }
  watch.callbacks.add(callback);
  callback(watch.size);
  return () => {
    const current = watched.get(element);
    if (!current) return;
    current.callbacks.delete(callback);
    if (current.callbacks.size > 0) return;
    watched.delete(element);
    observer?.unobserve(element);
  };
}

/** 元素尺寸 hook：通过回调 ref 挂载，节点变化时自动重新订阅；首次测量前为 null。 */
export function useElementSize<T extends Element>(): {
  ref: (node: T | null) => void;
  size: ElementSize | null;
} {
  const [size, setSize] = useState<ElementSize | null>(null);
  const release = useRef<(() => void) | null>(null);
  const ref = useCallback((node: T | null) => {
    release.current?.();
    release.current = node ? observeElementSize(node, setSize) : null;
  }, []);
  return { ref, size };
}
