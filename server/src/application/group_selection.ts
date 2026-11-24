import { selectedGroupsFilter } from "../engine/metric_calculator.js";
import { memberShortName } from "../semantic_core/member_name.js";
import { sortRowsByOrder } from "../engine/time_executor.js";
import type { QueryViewSpec, TopNSelectionSpec } from "../semantic_core/analysis_spec.js";
import type { BoundGroupSelection, ExecutedViewResult } from "./query_pipeline.js";

type Block = ExecutedViewResult["block"];

export function selectedGroupKeys(block: Block, dimensions: string[]): (string | null)[][] {
  const indices = dimensions.map((member) =>
    block.columns.findIndex((column) => memberShortName(column) === memberShortName(member)),
  );
  if (indices.some((index) => index < 0)) throw new Error("Top-N 排名来源缺少分组键");
  const groups = block.rows.map((row) =>
    indices.map((index) => (row[index] == null ? null : String(row[index]))),
  );
  return [...new Map(groups.map((group) => [JSON.stringify(group), group])).values()];
}

export function bindSelectedGroups(
  spec: TopNSelectionSpec,
  groups: (string | null)[][],
  hasMore: boolean,
): BoundGroupSelection {
  const byName = spec.dimensions.includes(spec.by);
  return {
    groups,
    filter: selectedGroupsFilter(
      spec.dimensions,
      groups.map((values) =>
        Object.fromEntries(spec.dimensions.map((member, index) => [member, values[index]])),
      ),
    ),
    outcome: {
      dimensions: spec.dimensions,
      by: spec.by,
      window: byName ? "all" : "anchor",
      direction: spec.direction,
      requestedCount: spec.count,
      selectedCount: groups.length,
      hasMoreGroups: hasMore,
    },
  };
}

export function orderSelectedGroups(block: Block, selection: BoundGroupSelection): Block {
  const indices = selection.outcome.dimensions.map((member) =>
    block.columns.findIndex((column) => memberShortName(column) === memberShortName(member)),
  );
  const rank = new Map(selection.groups.map((group, index) => [JSON.stringify(group), index]));
  const at = (row: Block["rows"][number]) =>
    rank.get(
      JSON.stringify(indices.map((index) => (row[index] == null ? null : String(row[index])))),
    ) ?? Number.MAX_SAFE_INTEGER;
  return { ...block, rows: [...block.rows].sort((left, right) => at(left) - at(right)) };
}

export function orderResultRows(block: Block, order?: QueryViewSpec["order"]): Block {
  if (!order?.length) return block;
  const columns = block.columns.map(memberShortName);
  const rows = block.rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index]])),
  );
  const ordering = order.map(({ member, direction }): [string, "asc" | "desc"] => [
    memberShortName(member),
    direction,
  ]);
  sortRowsByOrder(rows, ordering);
  return { ...block, rows: rows.map((record) => columns.map((column) => record[column])) };
}
