/**
 * 全局快捷键的共同前提：输入场景不抢注。
 *
 * 焦点落在可编辑元素时，键盘属于那个输入框——`?` 是正文字符，`⌘B` 在富文本里是加粗，
 * `⌘.` 在输入法候选态有自己的含义。全局监听器抢下来，用户看到的是打不出字。
 *
 * 判据按结构取（closest / isContentEditable），不靠宿主的 DOM 类，无 DOM 也能单测。
 */

/** 判据要问的那几样，DOM Element 满足它。 */
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

/** 会把焦点收进自己身体里的浮层：它开着时 Esc 归它。 */
const POPUP_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * 这一下 Esc 是否归最外层的右栏：输入框里的归输入法，浮层里的归那层浮层；
 * 只有键落在浮层之外，或落在承载右栏的那个容器自身时，才算给右栏的。
 */
export function escapeClaimsAside(
  event: { key: string; target: AnyTarget },
  asideRoot: KeyTarget | null,
): boolean {
  if (event.key !== "Escape" || isEditableTarget(event.target)) return false;
  const popup = asKeyTarget(event.target)?.closest(POPUP_SELECTOR) ?? null;
  return popup === null || popup === asideRoot;
}
