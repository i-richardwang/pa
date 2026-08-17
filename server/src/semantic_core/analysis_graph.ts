/**
 * 分析计算图的结构约束：语义层与物理层共用同一套判定与文案。两层只提供各自派生列的
 * 读法（来源操作数与输出列名），图本身的规则单源在此。
 */

type GraphNode = { id: string; view_title?: string; from?: readonly string[] };

/** 派生列的来源操作数；label 是该层可读的列标识，省略时错误文案不点名列。 */
export type DerivedOperand = { source: string; label?: string };

export type DerivedColumnReader<Column> = {
  operands: (column: Column) => DerivedOperand[];
  outputName: (column: Column) => string;
};

type DerivedGraphNode<Column> = {
  id: string;
  view_title: string;
  from: string[];
  join?: unknown;
  columns: Column[];
  order?: { by: string }[];
};

const isDerived = (view: GraphNode): boolean => "from" in view;

/** 一次分析只有一个答案：计算图必须恰好收敛到一个未被继续消费的结果节点。 */
export function analysisGraphSink(views: readonly GraphNode[]): string {
  const consumed = new Set(views.flatMap((view) => [...(view.from ?? [])]));
  const sinks = views.filter((view) => !consumed.has(view.id)).map((view) => view.id);
  if (sinks.length !== 1) {
    throw new Error(
      `一次分析只能回答一个问题；当前有 ${sinks.length} 个独立结果` +
        `${sinks.length ? `（${sinks.join("、")}）` : ""}，请拆成多次 run_analysis 调用`,
    );
  }
  return sinks[0];
}

/** 派生节点的引用、join 元数与输出列约束。 */
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
  const allowed = new Set(view.from);
  for (const column of view.columns) {
    for (const operand of read.operands(column)) {
      if (!allowed.has(operand.source)) {
        throw new Error(
          `派生视图「${view.view_title}」${operand.label ? `的列 ${operand.label} ` : ""}` +
            `引用了未在 from 声明的视图 ${operand.source}`,
        );
      }
    }
  }
  const resultColumns = view.columns.map(read.outputName);
  const duplicate = resultColumns.find((name, index) => resultColumns.indexOf(name) !== index);
  if (duplicate) throw new Error(`派生视图「${view.view_title}」的输出列名「${duplicate}」重复`);
  for (const order of view.order ?? []) {
    if (!resultColumns.includes(order.by)) {
      throw new Error(`派生视图「${view.view_title}」的排序列「${order.by}」不在输出列中`);
    }
  }
}
