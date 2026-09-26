/**
 * MCP widget 的结果卡片：只负责外框和空状态、等待状态，内容交给 ViewRenderer。
 * 边框由卡片自己画，资源声明 prefersBorder: false。
 * inline 模式下卡内不滚动（宿主设计规范），行数过多时引导用户全屏查看。
 */
import { LoadingMark, type CardActions, ViewRenderer } from "pa-result-view";
import type { PresentationBlock } from "@charts";
import type { QueryPayload } from "@payload";

export function ResultCard({
  payload,
  presentation,
  status,
  waiting,
  fullscreen,
  actions,
}: {
  payload: QueryPayload | null;
  presentation: PresentationBlock | null;
  /** payload 为空时显示的状态文案 */
  status: string;
  /** 为 true 时表示正在等待结果，显示加载标记而不是状态文案 */
  waiting: boolean;
  /** 宿主处于全屏模式：卡片限宽居中，表格显示全部行 */
  fullscreen: boolean;
  actions: CardActions;
}) {
  const frame = fullscreen ? "mx-auto w-full max-w-5xl" : "";

  if (!payload || !presentation) {
    return (
      <div className={frame}>
        <div className="flex h-44 items-center justify-center rounded-md border border-pa-line bg-pa-bg">
          {waiting ? <LoadingMark /> : <p className="px-4 text-pa-muted">{status}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={frame}>
      <div className="overflow-hidden rounded-md border border-pa-line bg-pa-bg">
        <ViewRenderer
          payload={payload}
          presentation={presentation}
          actions={actions}
          allRows={fullscreen}
          scene="card"
        />
      </div>
    </div>
  );
}
