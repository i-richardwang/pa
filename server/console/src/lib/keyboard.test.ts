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

test("位于输入框内或 contenteditable 中的目标视为可编辑", () => {
  expect(isEditableTarget(node({ "input, textarea, select, [contenteditable]": ASIDE }))).toBe(
    true,
  );
  expect(isEditableTarget(node({}, true))).toBe(true);
  expect(isEditableTarget(node({}))).toBe(false);
  expect(isEditableTarget(null)).toBe(false);
  expect(isEditableTarget("not a node" as unknown as EventTarget)).toBe(false);
});

test("Esc 落在浮层之外或右栏容器自身时收起右栏", () => {
  expect(escapeClaimsAside({ key: "Escape", target: node({}) }, ASIDE)).toBe(true);
  expect(escapeClaimsAside({ key: "Escape", target: node({ [POPUPS]: ASIDE }) }, ASIDE)).toBe(true);
});

test("在其他按键、输入框内或另一层浮层中时 Esc 不收起右栏", () => {
  expect(escapeClaimsAside({ key: "Enter", target: node({}) }, ASIDE)).toBe(false);
  expect(escapeClaimsAside({ key: "Escape", target: node({}, true) }, ASIDE)).toBe(false);
  expect(escapeClaimsAside({ key: "Escape", target: node({ [POPUPS]: MENU }) }, ASIDE)).toBe(false);
});
