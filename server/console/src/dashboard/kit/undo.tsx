/**
 * 移除类操作的撤销提示。移除在点击时已经保存，toast 只提供「撤销」这个逆操作。
 * AlertDialog 只用于安全敏感操作（API Key 吊销）和放弃未保存的编辑。
 * Base UI 在悬停时暂停 toast 倒计时。
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

/** 写操作失败的统一提示：401 交给会话层处理，409 提示刷新后重试。 */
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
