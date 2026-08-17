/**
 * 序数维度排序：职级、阶段分类等维度的取值有业务序（职级从高到低），字符串排序会
 * 声明序覆盖字符串序，避免业务分档标签误排。
 * 模型层以 meta.value_order 声明业务序（声明序即呈现序，随 /v1/meta 暴露），
 * 本模块是引擎边界的唯一排序点：查询未显式 order 时，按声明序稳定重排结果行，
 * 文本应答、CSV 导出与预览卡片同一顺序。
 *
 * 只重排声明维度：其余维度（组织、时间等）以取值首现序作复合键参与排序——
 * 引擎返回的分组与相对顺序原样保留，声明维度只在同组内归位，不打散不越界。
 */
import type { CubeQuery, CubeView } from "../ports/cube_gateway.js";

/** 声明序判定（纯函数）：orderOf 为成员名 → 声明取值序 */
export function sortByValueOrder<T extends Record<string, unknown>>(
  data: T[],
  query: CubeQuery,
  orderOf: Map<string, string[]>,
): T[] {
  if (query.order?.length) return data; // 显式排序是查询语义的一部分，不覆盖
  const dims = (query.dimensions ?? []).filter((d) => data.length && d in data[0]);
  const declared = dims.filter((d) => orderOf.has(d));
  if (!declared.length) return data;

  // 每个维度一个取值 → 序号映射：声明维度用声明序（未声明的取值排在声明值之后、按首现序），
  // 其余维度用首现序（复合键下等价于保持原分组与原相对顺序）
  const rankOf = dims.map((d) => {
    const rank = new Map<string, number>();
    const listed = orderOf.get(d);
    listed?.forEach((v, i) => {
      rank.set(v, i);
    });
    const base = listed?.length ?? 0;
    for (const row of data) {
      const v = String(row[d] ?? "");
      if (!rank.has(v)) rank.set(v, base + rank.size);
    }
    return rank;
  });

  return data
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      for (let k = 0; k < dims.length; k += 1) {
        const ra = rankOf[k].get(String(a.row[dims[k]] ?? "")) ?? 0;
        const rb = rankOf[k].get(String(b.row[dims[k]] ?? "")) ?? 0;
        if (ra !== rb) return ra - rb;
      }
      return a.i - b.i;
    })
    .map((x) => x.row);
}

/** 声明序注册表：/v1/meta 中带 meta.value_order 的维度（view 前缀成员名） */
function valueOrderMap(views: CubeView[]): Map<string, string[]> {
  const entries = views.flatMap((v) =>
    v.dimensions
      .filter((d) => Array.isArray(d.meta?.value_order))
      .map((d): [string, string[]] => [d.name, (d.meta!.value_order as unknown[]).map(String)]),
  );
  return new Map(entries);
}

export function applyValueOrder<T extends Record<string, unknown>>(
  data: T[],
  query: CubeQuery,
  views: CubeView[],
): T[] {
  return sortByValueOrder(data, query, valueOrderMap(views));
}
