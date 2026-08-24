/**
 * 移除类操作的回执。动作在用户点下时就已落库，这里只发回执并把逆操作挂在「撤销」上：
 * 回执是界面，不是待办——页面此刻消失也不会丢掉任何一次已发生的移除。
 * AlertDialog 只留给安全敏感操作（API Key 吊销）与放弃未保存的编辑。
 * 悬停 toast 会顺延倒计时（Base UI 悬停暂停）。
 */
import { toastManager } from "@/components/ui/toast";
import { ApiError, errorText } from "../api";

const UNDO_TIMEOUT_MS = 5000;

export function toastWithUndo({
  title,
  undo,
}: {
  title: string;
  undo: () => Promise<unknown>;
}): void {
  toastManager.add({
    type: "success",
    title,
    timeout: UNDO_TIMEOUT_MS,
    actionProps: {
      children: "撤销",
      onClick: () => {
        void undo().catch((reason: unknown) => toastMutationFailure("撤销失败", reason));
      },
    },
  });
}

/** 写失败的统一提示：401 交给会话层接管，409 给出可执行的下一步。 */
export function toastMutationFailure(title: string, reason: unknown): void {
  const message = errorText(reason);
  if (message === null) return;
  const conflict = reason instanceof ApiError && reason.status === 409;
  toastManager.add({
    type: "error",
    title: conflict ? "对象已被其他操作更新" : title,
    description: conflict ? "请刷新后重试。" : message,
  });
}
