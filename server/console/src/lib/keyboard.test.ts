import { expect, test } from "bun:test";
import { escapeClaimsAside, isEditableTarget, type KeyTarget } from "./keyboard";

function node(within: Record<string, KeyTarget | null>, editable = false): KeyTarget {
  return {
    closest: (selector) => within[selector] ?? null,
    isContentEditable: editable,
  };
}

const ASIDE: KeyTarget = node({});
const MENU: KeyTarget = node({});
const POPUPS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

test("输入场景不抢注：输入框祖先或 contenteditable 都算可编辑", () => {
  expect(isEditableTarget(node({ "input, textarea, select, [contenteditable]": ASIDE }))).toBe(
    true,
  );
  expect(isEditableTarget(node({}, true))).toBe(true);
  expect(isEditableTarget(node({}))).toBe(false);
  expect(isEditableTarget(null)).toBe(false);
  expect(isEditableTarget("not a node" as unknown as EventTarget)).toBe(false);
});

test("Esc 归右栏：键落在浮层之外，或落在承载右栏的容器自身", () => {
  expect(escapeClaimsAside({ key: "Escape", target: node({}) }, ASIDE)).toBe(true);
  expect(escapeClaimsAside({ key: "Escape", target: node({ [POPUPS]: ASIDE }) }, ASIDE)).toBe(true);
});

test("Esc 不归右栏：别的键、输入框里、另一层浮层里", () => {
  expect(escapeClaimsAside({ key: "Enter", target: node({}) }, ASIDE)).toBe(false);
  expect(escapeClaimsAside({ key: "Escape", target: node({}, true) }, ASIDE)).toBe(false);
  expect(escapeClaimsAside({ key: "Escape", target: node({ [POPUPS]: MENU }) }, ASIDE)).toBe(false);
});
