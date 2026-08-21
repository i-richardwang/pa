/**
 * 结果卡外壳：MCP widget 专属容器；控制台查看面使用整页裸铺——
 * 只负责卡片视觉外框与空/等待态，内容栈全部交给 ViewRenderer。
 * 视觉结构：白面 + 发丝描边（docs/ui_spec.md 卡容器），无常驻投影；
 * 卡缘即容器缘，无外圈衬垫；标题与口径常驻内联（答数态口径必须撞脸）；
 * 卡片视觉自足，资源声明不要宿主边框（prefersBorder: false）。
 * inline 模式不做内部滚动（宿主设计规范），行数超限引导全屏。
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
  /** 服务端确定性编译的完整呈现块。 */
  presentation: PresentationBlock | null;
  /** payload 为空时显示的状态文案 */
  status: string;
  /** true = 等待结果中（出加载标记而非状态文案） */
  waiting: boolean;
  /** 宿主展示模式是全屏：卡面限宽居中，表格放开全量行 */
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
