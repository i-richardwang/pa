/**
 * 分级 Undo：删除类操作先更新界面，toast 关闭时才提交后端，
 * 「撤销」取消提交并由调用方还原界面。悬停 toast 会顺延倒计时（Base UI 悬停暂停）。
 * 仅安全敏感操作（API Key 吊销）与放弃未保存编辑仍走 AlertDialog 确认。
 * 倒计时内整页卸载会丢提交，属乐观界面的既定取舍。
 */
import { toastManager } from "@/components/ui/toast";

const UNDO_TIMEOUT_MS = 5000;

export function performUndoable({
  title,
  commit,
  revert,
}: {
  title: string;
  commit: () => void | Promise<void>;
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
      if (!undone) void commit();
    },
  });
}
