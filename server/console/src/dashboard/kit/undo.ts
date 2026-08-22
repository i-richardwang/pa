/**
 * 移除资产的统一回执：界面先撤下，toast 关闭时才提交后端，「撤销」取消提交并由调用方还原界面。
 * 看板删除、报告归档、术语删除都走这一条；AlertDialog 只留给安全敏感操作（API Key 吊销）
 * 与放弃未保存的编辑。提交失败时印错误回执并还原界面；倒计时内整页卸载会丢提交，
 * 属乐观界面的既定取舍。悬停 toast 会顺延倒计时（Base UI 悬停暂停）。
 */
import { toastManager } from "@/components/ui/toast";
import { ApiError } from "../api";

const UNDO_TIMEOUT_MS = 5000;

export function performUndoable({
  title,
  failureTitle,
  commit,
  revert,
}: {
  title: string;
  failureTitle: string;
  commit: () => Promise<unknown>;
  revert: () => void;
}): void {
  let undone = false;
  toastManager.add({
    type: "success",
    title,
    timeout: UNDO_TIMEOUT_MS,
    actionProps: {
      children: "撤销",
      onClick: () => {
        undone = true;
        revert();
      },
    },
    onClose: () => {
      if (undone) return;
      void commit().catch((reason: unknown) => {
        revert();
        if (reason instanceof ApiError && reason.status === 401) return;
        const conflict = reason instanceof ApiError && reason.status === 409;
        toastManager.add({
          type: "error",
          title: conflict ? "对象已被其他操作更新" : failureTitle,
          description: conflict
            ? "请刷新后重试。"
            : reason instanceof Error
              ? reason.message
              : String(reason),
        });
      });
    },
  });
}
