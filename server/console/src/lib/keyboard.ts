/** 焦点在可编辑元素上时，全局快捷键不响应。 */

/** DOM Element 满足此结构，测试可用普通对象代替。 */
export type KeyTarget = {
  closest(selector: string): KeyTarget | null;
  isContentEditable?: boolean;
};

type AnyTarget = EventTarget | KeyTarget | null;

function asKeyTarget(target: AnyTarget): KeyTarget | null {
  return target && typeof (target as KeyTarget).closest === "function"
    ? (target as KeyTarget)
    : null;
}

export function isEditableTarget(target: AnyTarget): boolean {
  const node = asKeyTarget(target);
  return (
    node !== null &&
    (node.closest("input, textarea, select, [contenteditable]") !== null ||
      node.isContentEditable === true)
  );
}

const POPUP_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** 右栏容器自身也带浮层角色；事件目标在右栏容器上时，Esc 仍由右栏处理。 */
export function escapeClaimsAside(
  event: { key: string; target: AnyTarget },
  asideRoot: KeyTarget | null,
): boolean {
  if (event.key !== "Escape" || isEditableTarget(event.target)) return false;
  const popup = asKeyTarget(event.target)?.closest(POPUP_SELECTOR) ?? null;
  return popup === null || popup === asideRoot;
}
