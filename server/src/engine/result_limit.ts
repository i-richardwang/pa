/**
 * 返回上限语义：cap 为交付行数上限，查询一律多取 1 行探知是否仍有更多——
 * 事实进 has_more（总数不可知时不谎报）。业务 Top-N 由独立选择算子表达；这里的 cap
 * 只属于服务交付预算，触顶恒为不完整结果并附 truncated 引导下载或收窄范围。
 * 本模块是该语义的唯一判定点（聚合查询与导出共用），server.ts 只组装。
 *
 * 聚合路由的上限分两级，面向的读者不同：
 * - 卡片交付上限（AGGREGATE_CARD_ROWS）：用户在结果卡看到的行数天花板——引擎按此取数，
 *   全量行经 _meta 直达结果卡与重放载荷；超出才算真截断，单视图时自动附完整结果导出链接；
 * - 模型样本上限（AGGREGATE_MODEL_ROWS）：进模型上下文的行数天花板——交付行数超出时
 *   rows 只留头部样本（上下文经济），row_count 仍为交付用户的真实行数，sampled 注明语义。
 */

/** 聚合结果的卡片交付上限：结果卡向用户完整展示的行数天花板 */
export const AGGREGATE_CARD_ROWS = 2000;

/** 聚合结果进模型上下文的样本上限 */
export const AGGREGATE_MODEL_ROWS = 200;

/** 模型样本注记：防 agent 把样本内合计/计数当总量，或误以为用户没看到全量 */
export function modelSampleNote(delivered: number): string {
  return (
    `结果共 ${delivered} 行已全部在结果卡向用户展示，rows 仅为前 ${AGGREGATE_MODEL_ROWS} 行样本。` +
    `作答以 row_count 为准，不要把样本内的合计/计数当作总量，也无需向用户逐行复述——卡片已完整呈现。`
  );
}

export type LimitOutcome = {
  /** 实际交付行数（探测多取的 1 行已剔除） */
  rowCount: number;
  /** 结果集是否未被交付预算完整覆盖 */
  hasMore: boolean;
  /** 交付预算触顶时的重查引导 */
  truncated?: string;
};

/** fetched 为引擎实际返回行数（含探测多取的 1 行）。 */
export function resolveLimitOutcome(fetched: number, cap: number): LimitOutcome {
  const hasMore = fetched > cap;
  return {
    rowCount: Math.min(fetched, cap),
    hasMore,
    ...(hasMore
      ? {
          truncated:
            `结果超过 ${cap} 行，仅交付前 ${cap} 行（总行数未知）——` +
            `完整结果通过导出链接下载，或加过滤缩小范围`,
        }
      : {}),
  };
}

/**
 * 顶格导出触引擎上限时完整性不可确认（引擎上限无法多取探测），由路由拒绝交付。
 */
export function isBoundedResultComplete(fetched: number, maxRows: number): boolean {
  return fetched < maxRows;
}
