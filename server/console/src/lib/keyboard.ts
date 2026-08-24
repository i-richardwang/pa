/** 全局快捷键的共同前提：焦点落在可编辑元素时，键盘归那个输入框。 */

/** DOM Element 满足这个结构。 */
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

/** 承载右栏的容器自身也带浮层角色，落在它上面算给右栏。 */
export function escapeClaimsAside(
  event: { key: string; target: AnyTarget },
  asideRoot: KeyTarget | null,
): boolean {
  if (event.key !== "Escape" || isEditableTarget(event.target)) return false;
  const popup = asKeyTarget(event.target)?.closest(POPUP_SELECTOR) ?? null;
  return popup === null || popup === asideRoot;
}
