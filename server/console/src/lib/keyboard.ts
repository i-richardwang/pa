/**
 * 全局快捷键的共同前提：输入场景不抢注。
 *
 * 焦点落在可编辑元素时，键盘属于那个输入框——`?` 是正文字符，`⌘B` 在富文本里是加粗，
 * `⌘.` 在输入法候选态有自己的含义。全局监听器抢下来，用户看到的是打不出字。
 *
 * 这条前提只有这一处拼写：壳的三个分支与侧栏的 `⌘B` 同取。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.closest("input, textarea, select, [contenteditable]") !== null ||
      target.isContentEditable)
  );
}
