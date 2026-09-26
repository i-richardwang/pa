import { expect, test } from "bun:test";
import { watchDismiss, type DismissEvent, type DismissHost } from "./dismiss.js";

const INSIDE = "inside" as unknown as Node;

/** 记录监听器的假事件源，用来检查注册了哪些事件、事件分发给谁、退订后还剩哪些。 */
function stubHost() {
  const handlers = new Map<string, ((event: DismissEvent) => void)[]>();
  const host: DismissHost = {
    addEventListener: (type, handler) =>
      void handlers.set(type, [...(handlers.get(type) ?? []), handler]),
    removeEventListener: (type, handler) =>
      void handlers.set(
        type,
        (handlers.get(type) ?? []).filter((each) => each !== handler),
      ),
  };
  return {
    host,
    types: () => [...handlers.keys()].sort(),
    attached: () => [...handlers.values()].flat().length,
    fire: (event: DismissEvent) => {
      for (const handler of handlers.get(event.type) ?? []) handler(event);
    },
  };
}

function watching(within: { contains(node: Node): boolean } | null) {
  const stub = stubHost();
  let dismissed = 0;
  const release = watchDismiss(
    stub.host,
    () => within,
    () => dismissed++,
  );
  return { ...stub, release, count: () => dismissed };
}

test("按 Esc 关闭，其他按键不关闭", () => {
  const block = { contains: (node: Node) => node === INSIDE };
  const watch = watching(block);
  watch.fire({ type: "keydown", key: "Escape" });
  expect(watch.count()).toBe(1);
  // 普通按键不应关闭读数卡
  watch.fire({ type: "keydown", key: "e" });
  watch.fire({ type: "keydown", key: "Enter" });
  expect(watch.count()).toBe(1);
});

test("在元素外按下鼠标时关闭，在元素内按下时不关闭", () => {
  const block = { contains: (node: Node) => node === INSIDE };
  const watch = watching(block);
  watch.fire({ type: "mousedown", target: INSIDE });
  expect(watch.count(), "在卡片内按下不应关闭卡片").toBe(0);
  watch.fire({ type: "mousedown", target: "elsewhere" });
  expect(watch.count()).toBe(1);

  // 元素尚未挂载时，任何位置按下都关闭
  const orphan = watching(null);
  orphan.fire({ type: "mousedown", target: INSIDE });
  expect(orphan.count()).toBe(1);
});

test("只监听 keydown 和 mousedown，退订后不再响应", () => {
  const watch = watching({ contains: () => false });
  expect(watch.types()).toEqual(["keydown", "mousedown"]);

  watch.release();
  expect(watch.attached(), "浮层关闭后仍有未移除的事件监听").toBe(0);
  watch.fire({ type: "keydown", key: "Escape" });
  expect(watch.count()).toBe(0);
});
