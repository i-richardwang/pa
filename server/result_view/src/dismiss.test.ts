/**
 * 撤下策略单测：钉住的浮层认哪两下、不认哪两下，以及撤下后订阅是否真的解掉。
 *
 * 宿主由调用方交进来，故这三件不必支起 DOM——它们恰恰是静态渲染看不见的那一部分。
 * 断言一律从 `watchDismiss` 这道生产入口进：判据单独拎出来问，问不出订阅那半边的形。
 */
import { expect, test } from "bun:test";
import { watchDismiss, type DismissEvent, type DismissHost } from "./dismiss.js";

const INSIDE = "inside" as unknown as Node;

/** 一副记账的宿主：挂了哪些事件、事件来了谁接、解订后还剩谁，都从这里问。 */
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

test("Esc 撤下，别的键一概不动", () => {
  const block = { contains: (node: Node) => node === INSIDE };
  const watch = watching(block);
  watch.fire({ type: "keydown", key: "Escape" });
  expect(watch.count()).toBe(1);
  // 反向：随手敲字不该把读数卡撤走
  watch.fire({ type: "keydown", key: "e" });
  watch.fire({ type: "keydown", key: "Enter" });
  expect(watch.count()).toBe(1);
});

test("按在这一块之外才撤下，按在块内是在用它", () => {
  const block = { contains: (node: Node) => node === INSIDE };
  const watch = watching(block);
  watch.fire({ type: "mousedown", target: INSIDE });
  expect(watch.count(), "按在卡上就把卡按没了").toBe(0);
  watch.fire({ type: "mousedown", target: "elsewhere" });
  expect(watch.count()).toBe(1);

  // 块还没挂上：没有「里面」可言，按哪儿都算外面
  const orphan = watching(null);
  orphan.fire({ type: "mousedown", target: INSIDE });
  expect(orphan.count()).toBe(1);
});

test("只挂这两种事件，解订之后一概不认", () => {
  const watch = watching({ contains: () => false });
  expect(watch.types()).toEqual(["keydown", "mousedown"]);

  watch.release();
  expect(watch.attached(), "解订没撤干净，浮层没了监听还在").toBe(0);
  watch.fire({ type: "keydown", key: "Escape" });
  expect(watch.count()).toBe(0);
});
