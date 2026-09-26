/**
 * 语义层与物理层共用的派生结果校验（列来源、输出列名、排序列）；
 * 物理层另外校验 views 图的引用与唯一出口。
 */

type GraphNode = { id: string; view_title?: string; from?: readonly string[] };

/** label 用于在错误消息中指明列，可省略。 */
export type DerivedOperand = { source: string; label?: string };

export type DerivedColumnReader<Column> = {
  operands: (column: Column) => DerivedOperand[];
  outputName: (column: Column) => string;
};

type DerivedColumns<Column> = {
  view_title: string;
  columns: Column[];
  order?: { by: string }[];
};

type DerivedGraphNode<Column> = DerivedColumns<Column> & {
  id: string;
  from: string[];
  join?: unknown;
};

const isDerived = (view: GraphNode): boolean => "from" in view;

export function analysisGraphSink(views: readonly GraphNode[]): string {
  const consumed = new Set(views.flatMap((view) => [...(view.from ?? [])]));
  const sinks = views.filter((view) => !consumed.has(view.id)).map((view) => view.id);
  if (sinks.length !== 1) {
    throw new Error(
      `执行图必须只有一个最终结果；当前有 ${sinks.length} 个` +
        `${sinks.length ? `（${sinks.join("、")}）` : ""}`,
    );
  }
  return sinks[0];
}

export function validateDerivedColumns<Column>(
  view: DerivedColumns<Column>,
  sources: readonly string[],
  read: DerivedColumnReader<Column>,
): void {
  const allowed = new Set(sources);
  for (const column of view.columns) {
    for (const operand of read.operands(column)) {
      if (!allowed.has(operand.source)) {
        throw new Error(
          `派生结果「${view.view_title}」${operand.label ? `的列 ${operand.label} ` : ""}` +
            `引用了不存在的来源 ${operand.source}；可用来源：${sources.join("、")}`,
        );
      }
    }
  }
  const resultColumns = view.columns.map(read.outputName);
  const duplicate = resultColumns.find((name, index) => resultColumns.indexOf(name) !== index);
  if (duplicate) throw new Error(`派生结果「${view.view_title}」的输出列名「${duplicate}」重复`);
  for (const order of view.order ?? []) {
    if (!resultColumns.includes(order.by)) {
      throw new Error(
        `派生结果「${view.view_title}」的排序列「${order.by}」不在输出列中；` +
          `输出列：${resultColumns.join("、")}`,
      );
    }
  }
}

export function validateDerivedGraphView<Column>(
  view: DerivedGraphNode<Column>,
  views: readonly GraphNode[],
  read: DerivedColumnReader<Column>,
): void {
  if (new Set(view.from).size !== view.from.length) {
    throw new Error(`派生视图「${view.view_title}」的 from 不得重复引用同一视图`);
  }
  const byId = new Map(views.map((candidate) => [candidate.id, candidate]));
  for (const source of view.from) {
    const candidate = byId.get(source);
    if (!candidate) throw new Error(`派生视图「${view.view_title}」引用的视图 ${source} 不存在`);
    if (candidate.id === view.id || isDerived(candidate)) {
      throw new Error(`派生视图「${view.view_title}」只能直接引用查询视图`);
    }
    if (!candidate.view_title?.trim()) {
      throw new Error(`派生结果「${view.view_title}」引用的每个来源查询都必须提供业务标题`);
    }
  }
  if (view.from.length === 2 && !view.join) {
    throw new Error(`派生视图「${view.view_title}」引用两个视图时必须声明 join`);
  }
  if (view.from.length === 1 && view.join) {
    throw new Error(`派生视图「${view.view_title}」只引用一个视图时不能声明 join`);
  }
  validateDerivedColumns(view, view.from, read);
}
