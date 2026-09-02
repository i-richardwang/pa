import type {
  CubeGateway,
  CubeMember,
  CubeQuery,
  CubeSecurityContext,
  CubeView,
  TimeContext,
} from "../ports/cube_gateway.js";
import type { Principal } from "../contracts/principal.js";
import type { ExportService } from "./export_service.js";
import { completeHierarchy } from "../engine/hierarchy.js";
import { memberDisplayTitle, showDimensionNote } from "../engine/member_presentation.js";
import { structureSharesOf } from "../engine/measure_relations.js";
import { assertMeasureFilterCompatibility, filterMembers } from "../engine/query_contract.js";
import { AGGREGATE_CARD_ROWS, resolveLimitOutcome } from "../engine/result_limit.js";
import {
  runQueryPipeline,
  type ExecutedViewResult,
  type QueryRunResult,
} from "./query_pipeline.js";
import { calculationColumnName, type QueryViewSpec } from "../semantic_core/analysis_spec.js";
import {
  COLUMN_DECIMALS_SCHEMA,
  COLUMN_FORMATS,
  isColumnFormat,
  type ColumnFormat,
} from "../semantic_core/query_payload.js";
import { executeMetricQuery, prepareMetricQueryExecution } from "../engine/metric_executor.js";
import { metricOutputMembers, metricTimeMembers } from "../engine/metric_planner.js";
import { applyGroupingSets } from "../engine/grouping_set_executor.js";
import { planGroupingSets } from "../engine/grouping_set_planner.js";
import { resultBuckets, resultCoordinates } from "../engine/time_plan.js";
import type {
  DerivedSourceSemantics,
  EngineViewBlock,
  SourceColumnSemantics,
} from "../engine/transform.js";
import { resolveMetricTime } from "../engine/metric_time.js";
import { computeMetricTotals } from "./view_totals.js";
import { applyValueOrder } from "../engine/value_order.js";
import { memberSemanticId } from "../engine/model_contract.js";
import { memberShortName, memberViewName } from "../semantic_core/member_name.js";
import type { AuthorizedAnalysisPlan } from "./semantic_planning_service.js";

function displayDescription(
  members: CubeMember[],
  name: string,
  kind: "measure" | "dimension",
): string {
  const member = members.find((candidate) => candidate.name === name);
  if (kind === "dimension" && !showDimensionNote(member)) return "";
  return (member?.description ?? "").trim();
}

function agentDescription(
  members: CubeMember[],
  name: string,
  fallbackDescription: string,
): string {
  const member = members.find((candidate) => candidate.name === name);
  const description = (member?.description ?? fallbackDescription).trim();
  const aiContext =
    typeof member?.meta?.ai_context === "string" ? member.meta.ai_context.trim() : "";
  return [description, aiContext].filter(Boolean).join(" ");
}

function appendNote(note: { text: string }, value: string): void {
  note.text = note.text ? `${note.text}（${value}）` : value;
}

function hierarchyAdditionTitles(
  views: CubeView[],
  addition: { member: string; children: string[] },
): { upperTitle: string; lowerTitles: string[] } {
  return {
    upperTitle: memberDisplayTitle(views, addition.member, memberShortName(addition.member)),
    lowerTitles: addition.children.map((child) =>
      memberDisplayTitle(views, child, memberShortName(child)),
    ),
  };
}

type OrderInput = { member: string; direction: "asc" | "desc" }[] | undefined;
function toOrderTuples(order: OrderInput): CubeQuery["order"] {
  return order?.map(({ member, direction }): [string, "asc" | "desc"] => [member, direction]);
}

function buildSourceSemantics(
  memberKeys: string[],
  columns: string[],
  authViews: CubeView[],
  timeView: string,
  time: DerivedSourceSemantics["time"],
  calculations: NonNullable<QueryViewSpec["grouping_sets"]>["calculations"] = [],
): DerivedSourceSemantics {
  if (new Set(columns).size !== columns.length) {
    throw new Error("查询结果列名在省略 view 前缀后发生碰撞；请联系维护者调整模型成员名");
  }
  const measures = new Map(
    authViews
      .flatMap((view) => [...view.measures, ...(view.internalMeasures ?? [])])
      .map((member) => [member.name, member]),
  );
  const dimensions = new Map(
    authViews.flatMap((view) => view.dimensions).map((member) => [member.name, member]),
  );
  const resolved = new Map<string, SourceColumnSemantics>();
  const calculationByColumn = new Map(
    (calculations ?? []).map((item) => [calculationColumnName(item.id), item]),
  );
  memberKeys.forEach((memberName, index) => {
    const column = columns[index];
    const calculation = calculationByColumn.get(memberName);
    if (calculation) {
      const measure = measures.get(calculation.measure);
      if (!measure) throw new Error(`计算「${calculation.title}」的基础指标不在查询结果中`);
      resolved.set(column, {
        member: memberName,
        alias: calculation.id,
        kind: "measure",
        valueType: "number",
        timeEvaluation: resolveMetricTime(measure, measures).evaluation,
      });
      return;
    }
    const measure = measures.get(memberName);
    const dimension = dimensions.get(memberName);
    if (measure) {
      const metricTime = resolveMetricTime(measure, measures);
      resolved.set(column, {
        member: memberName,
        alias: measure.aliasMember ?? measure.name,
        kind: "measure",
        valueType: measure.type,
        timeEvaluation: metricTime.evaluation,
      });
      return;
    }
    if (dimension) {
      resolved.set(column, {
        member: memberName,
        alias: dimension.aliasMember ?? dimension.name,
        kind: "dimension",
        valueType: dimension.type,
        semanticId: memberSemanticId("dimension", memberName),
      });
      return;
    }
    const short = memberShortName(memberName);
    if (memberName === `${timeView}.${short}` && (short === "year" || short === "month")) {
      resolved.set(column, {
        member: memberName,
        alias: `time.${short}`,
        kind: "time",
        valueType: "string",
      });
      return;
    }
    throw new Error(`查询结果列 ${memberName} 无法解析到公开成员或系统生成的时间列`);
  });
  return { columns: resolved, time };
}

/**
 * 执行单个查询视图：授权、层级补全、时间规划、Cube 投影、序数归位与列式编码。
 * 受控记录字段不属于公开查询面，只能经 Record Projection 端点投影。
 */
async function executeView(
  deps: QueryExecutionDependencies,
  ctx: {
    principal: Principal;
    cubeContext: CubeSecurityContext;
  },
  spec: QueryViewSpec,
  authViews: CubeView[],
  context: TimeContext,
  includeSummary: boolean,
  includeTotals: boolean,
  accessScopeTitle: string,
): Promise<ExecutedViewResult> {
  const { principal, cubeContext } = ctx;
  const inputQuery: CubeQuery = {
    measures: spec.measures,
    dimensions: spec.grouping_sets?.base.map((dimension) => dimension.member) ?? spec.dimensions,
    filters: spec.filters,
    order: toOrderTuples(spec.order),
  };
  const { measures, dimensions, filters, order } = inputQuery;
  const publicMembers = new Set(
    authViews
      .flatMap((view) => [...view.measures, ...view.dimensions])
      .map((member) => member.name),
  );
  const requestedMembers = [
    ...(measures ?? []),
    ...(dimensions ?? []),
    ...filterMembers(filters),
    ...(order ?? []).map(([member]) => member),
    ...(spec.selection ? [spec.selection.by, ...spec.selection.dimensions] : []),
  ];
  if (requestedMembers.some((member) => !publicMembers.has(member))) {
    throw new Error("所选字段不在当前可用的数据目录中，请重新选择字段后再试");
  }
  assertMeasureFilterCompatibility({ measures, dimensions, filters, order }, authViews);
  const { query: shaped, added: hierarchyDimensions } = completeHierarchy(
    { measures, dimensions, filters, order },
    authViews,
  );
  const cap = AGGREGATE_CARD_ROWS;
  const prepared = await prepareMetricQueryExecution({
    cube: deps.cube,
    query: shaped,
    time: spec.time,
    context,
    views: authViews,
    securityContext: cubeContext,
    timeView: spec.time_view,
    selection: spec.selection,
  });
  const queryPlan = prepared.plan;
  const selectionState = prepared.selection;
  const selection = selectionState?.outcome;
  const effectiveQuery: CubeQuery = selection
    ? {
        ...shaped,
        filters: [...(shaped.filters ?? []), selectionState.filter],
      }
    : shaped;
  const groupingPlan = planGroupingSets({
    viewId: spec.id,
    baseQuery: effectiveQuery,
    baseGroupingSet:
      spec.grouping_sets?.base.map((dimension) => dimension.id) ??
      (spec.dimensions ?? []).map((dimension) => memberSemanticId("dimension", dimension)),
    basePlan: queryPlan,
    timePlanning: prepared.timePlanning,
    baselineFilters: shaped.filters,
    grouping: spec.grouping_sets,
    includeSummary,
    views: authViews,
    timeView: spec.time_view,
  });
  const [displayResolved, groupingLoads, metricTotals] = await Promise.all([
    prepared.precomputed
      ? Promise.resolve(prepared.precomputed)
      : executeMetricQuery(deps.cube, queryPlan, cubeContext, authViews),
    Promise.all(
      groupingPlan.legs.map((leg) =>
        executeMetricQuery(deps.cube, leg.plan, cubeContext, authViews),
      ),
    ),
    includeTotals
      ? computeMetricTotals({
          cube: deps.cube,
          query: shaped,
          context,
          views: authViews,
          securityContext: cubeContext,
          timeView: spec.time_view,
          businessTime: queryPlan.business_time,
        })
      : Promise.resolve([]),
  ]);
  const resolved = prepared.selection
    ? {
        ...displayResolved,
        selection: prepared.selection.outcome,
        selectionFilter: prepared.selection.filter,
      }
    : displayResolved;
  const groupingResolved = applyGroupingSets(
    groupingPlan,
    resolved,
    new Map(
      groupingPlan.legs.map((leg, index) => {
        const load = groupingLoads[index];
        if (!load) throw new Error(`分组腿 ${leg.id} 未返回执行结果`);
        return [leg.id, load];
      }),
    ),
  );
  const businessTime = queryPlan.business_time;
  const finalResolved = groupingResolved.load;
  const summaryResolved = groupingResolved.summary;
  if (selection && finalResolved.data.length > AGGREGATE_CARD_ROWS) {
    throw new Error(
      `Top-N 分组的完整结果共 ${finalResolved.data.length} 行，超过交付上限 ${AGGREGATE_CARD_ROWS}；` +
        "请减少 Top-N 数量或分组维度",
    );
  }
  if (groupingPlan.calculations.length && finalResolved.data.length > AGGREGATE_CARD_ROWS) {
    throw new Error(
      `构成占比结果共 ${finalResolved.data.length} 行，超过交付上限 ${AGGREGATE_CARD_ROWS}；` +
        "请增加筛选条件或减少分组维度",
    );
  }
  const annotations = [
    ...Object.entries(finalResolved.annotation.measures).map(([name, value]) => ({
      name,
      value,
      kind: "measure" as const,
    })),
    ...Object.entries(finalResolved.annotation.dimensions).map(([name, value]) => ({
      name,
      value,
      kind: "dimension" as const,
    })),
  ];
  const visibleMembers = authViews.flatMap((view) => [...view.measures, ...view.dimensions]);
  const notes = annotations.map(({ name, value }) => ({
    member: name,
    title: memberDisplayTitle(authViews, name, value.title),
    text: agentDescription(visibleMembers, name, value.description ?? ""),
  }));
  const displayNotes = annotations
    .map(({ name, value, kind }) => ({
      member: name,
      title: memberDisplayTitle(authViews, name, value.title),
      text: displayDescription(visibleMembers, name, kind),
    }))
    .filter((note) => note.text);

  if (selection) {
    const by = visibleMembers.find((member) => member.name === selection.by);
    const dimensionTitles = selection.dimensions.map((name) => {
      const member = visibleMembers.find((candidate) => candidate.name === name);
      return memberDisplayTitle(authViews, name, member?.title ?? memberShortName(name));
    });
    const rankingTitle = memberDisplayTitle(
      authViews,
      selection.by,
      by?.title ?? memberShortName(selection.by),
    );
    const selectionRule =
      selection.window === "anchor"
        ? `按最新逻辑时间桶的「${rankingTitle}」保留数值${selection.direction === "desc" ? "最高" : "最低"}的 ${selection.requestedCount} 个`
        : `按「${rankingTitle}」名称保留${selection.direction === "asc" ? "最靠前" : "最靠后"}的 ${selection.requestedCount} 个`;
    const text =
      `结果${selectionRule}「${dimensionTitles.join("、")}」分组，实际选中 ${selection.selectedCount} 个；` +
      (selection.window === "anchor"
        ? "其余查询时间桶只补齐这些分组，不参与排名。"
        : "全部时间桶只展示这些分组。");
    notes.push({ member: "notice:top_n_selection", title: "分组选择", text });
    displayNotes.push({
      member: "notice:top_n_selection",
      title: "结果范围",
      text,
    });
  }

  for (const mask of finalResolved.masked ?? []) {
    const member = visibleMembers.find((candidate) => candidate.name === mask.member);
    const title = memberDisplayTitle(
      authViews,
      mask.member,
      member?.title ?? memberShortName(mask.member),
    );
    const text =
      `「${title}」有 ${mask.groups} 个结果格的支撑量不足 ${mask.threshold}，` +
      "数值按最小支撑量保护未显示。";
    const note = {
      member: `notice:minimum_support:${memberShortName(mask.member)}`,
      title: "最小支撑量保护",
      text,
    };
    notes.push(note);
    displayNotes.push(note);
  }

  const queried = new Set(annotations.map((annotation) => annotation.name));
  if (
    visibleMembers.some(
      (member) => queried.has(member.name) && member.meta?.sensitivity === "restricted",
    )
  ) {
    displayNotes.push({
      member: "sensitivity",
      title: "数据权限",
      text: "本次结果包含敏感级数据，请注意使用与流转场景。",
    });
  }
  const hierarchyAdditions = new Map(
    hierarchyDimensions.map((addition) => [memberShortName(addition.member), addition]),
  );
  for (const note of notes) {
    const addition = hierarchyAdditions.get(memberShortName(note.member));
    if (addition) {
      const relation = hierarchyAdditionTitles(authViews, addition);
      const lowerTitles = relation.lowerTitles.map((title) => `「${title}」`).join("、");
      appendNote(
        note,
        `「${relation.upperTitle}」由系统自动带出，用于区分可能重名但属于不同上级的${lowerTitles}`,
      );
    }
  }
  for (const addition of hierarchyDimensions) {
    const source = notes.find(
      (note) => memberShortName(note.member) === memberShortName(addition.member),
    );
    if (source) {
      const relation = hierarchyAdditionTitles(authViews, addition);
      const lowerTitles = relation.lowerTitles.map((title) => `「${title}」`).join("、");
      displayNotes.push({
        member: addition.member,
        title: memberDisplayTitle(authViews, source.member, source.title),
        text: `为区分可能重名的${lowerTitles}，结果已按「${relation.upperTitle}」拆分。`,
      });
    }
  }
  if (principal.accessScope.kind === "limited") {
    const values = principal.accessScope.values.join("、") || "无可用值";
    notes.push({
      member: "access_scope",
      title: accessScopeTitle,
      text: `本账号的「${accessScopeTitle}」已自动限定为：${values}。回答时应明确这是授权范围，不应据此推断范围外的整体情况。`,
    });
    displayNotes.push({
      member: "access_scope",
      title: accessScopeTitle,
      text: `本次结果仅包含你有权查看的「${accessScopeTitle}」：${values}。`,
    });
  }

  const calculationColumns = groupingPlan.calculations.map((calculation) => calculation.column);
  const baseMemberKeys = metricOutputMembers(queryPlan);
  const memberKeys = [...baseMemberKeys, ...calculationColumns];
  const columnsOf = (keys: string[]) => {
    const singleView = new Set(keys.map(memberViewName)).size === 1;
    return singleView ? keys.map(memberShortName) : keys;
  };
  const memberFormats = new Map<string, ColumnFormat>(
    visibleMembers.flatMap((member) => {
      if (!member.format) return [];
      if (!isColumnFormat(member.format)) {
        throw new Error(
          `模型成员 ${member.name} 使用了不支持的 format=${member.format}；` +
            `请联系维护者改为 ${COLUMN_FORMATS.join("、")} 之一`,
        );
      }
      return [[member.name, member.format]];
    }),
  );
  const columnFormatsOf = (keys: string[], columns: string[]) =>
    Object.fromEntries(
      keys.flatMap((key, index) => {
        const format = memberFormats.get(key);
        return format ? [[columns[index], format]] : [];
      }),
    );
  const memberDecimals = new Map<string, number>(
    visibleMembers.flatMap((member) => {
      const decimals = member.meta?.decimals;
      if (decimals === undefined) return [];
      const parsed = COLUMN_DECIMALS_SCHEMA.safeParse(decimals);
      if (!parsed.success) {
        throw new Error(`模型成员 ${member.name} 的 meta.decimals 必须是 0–4 的整数`);
      }
      return [[member.name, parsed.data]];
    }),
  );
  const columnDecimalsOf = (keys: string[], columns: string[]) =>
    Object.fromEntries(
      keys.flatMap((key, index) => {
        const decimals = memberDecimals.get(key);
        return decimals === undefined ? [] : [[columns[index], decimals]];
      }),
    );
  const toCells = (records: Record<string, string | number | null>[]) =>
    records.map((record) => memberKeys.map((key) => record[key] ?? null));

  const completeResult = Boolean(selection) || groupingPlan.calculations.length > 0;
  const { rowCount, hasMore, truncated } = completeResult
    ? { rowCount: finalResolved.data.length, hasMore: false, truncated: undefined }
    : resolveLimitOutcome(finalResolved.data.length, cap);
  const records = completeResult
    ? finalResolved.data
    : applyValueOrder(finalResolved.data.slice(0, rowCount), shaped, authViews);
  const columns = [...columnsOf(baseMemberKeys), ...calculationColumns];
  const sourceSemantics = buildSourceSemantics(
    memberKeys,
    columns,
    authViews,
    queryPlan.time_view,
    businessTime,
    spec.grouping_sets?.calculations,
  );
  const columnFormats = {
    ...columnFormatsOf(baseMemberKeys, columns.slice(0, baseMemberKeys.length)),
    ...Object.fromEntries(calculationColumns.map((column) => [column, "percent" as const])),
  };
  const columnDecimals = columnDecimalsOf(memberKeys, columns);
  const columnRoles = Object.fromEntries(
    [...sourceSemantics.columns].map(([column, semantics]) => [column, semantics.kind]),
  );
  const modelStructureShares = structureSharesOf(baseMemberKeys, columns, visibleMembers);
  const columnOfMember = new Map(memberKeys.map((key, index) => [key, columns[index]]));
  const resolvedDeliveryColumns = Object.fromEntries(
    metricTimeMembers(queryPlan).map((member) => {
      const column = columnOfMember.get(member);
      if (!column) throw new Error(`已解析时间签名的成员 ${member} 不在执行结果列中`);
      return [column, memberShortName(member)];
    }),
  );
  const calculatedStructureShares = groupingResolved.structure_shares.map((share) => {
    const measure = columnOfMember.get(share.measure);
    const numerator = columnOfMember.get(share.numerator);
    if (!measure || !numerator) throw new Error("构成占比的结果列关系无法投影");
    return { measure, numerator };
  });
  const structureShares = [...modelStructureShares, ...calculatedStructureShares];
  const rows = toCells(records);
  const summaryRows = summaryResolved ? toCells(summaryResolved.data) : undefined;
  const totals = metricTotals.map(({ member, periods }) => {
    const column = columnOfMember.get(member);
    if (!column) throw new Error(`整窗合计的指标 ${member} 不在结果列中`);
    return { column, periods };
  });
  const block: EngineViewBlock = {
    id: spec.id,
    ...(spec.view_title ? { view_title: spec.view_title } : {}),
    columns,
    ...(Object.keys(columnFormats).length ? { column_formats: columnFormats } : {}),
    ...(Object.keys(columnDecimals).length ? { column_decimals: columnDecimals } : {}),
    column_roles: columnRoles,
    ...(structureShares.length ? { structure_shares: structureShares } : {}),
    rows,
    ...(summaryRows?.length
      ? {
          summary: {
            kind: "grand_total" as const,
            label: selection ? "所选分组总体" : "总体",
            scope: selection ? ("selected_groups" as const) : ("filtered_set" as const),
            rows: summaryRows,
          },
        }
      : {}),
    ...(totals.length ? { totals: { metrics: totals } } : {}),
    row_count: rows.length,
    has_more: hasMore,
    ...(truncated ? { truncated } : {}),
    ...(selection
      ? {
          selection_scope: {
            type: "top_n" as const,
            // 执行结果用内部词 dimensions，载荷回到公开词 grain：这是回程的唯一翻译点。
            grain: selection.dimensions,
            by: selection.by,
            window: selection.window,
            direction: selection.direction,
            requested_count: selection.requestedCount,
            selected_count: selection.selectedCount,
            has_more_groups: selection.hasMoreGroups,
          },
        }
      : {}),
    time: {
      grain: businessTime.outputGrain,
      coordinates: resultCoordinates(businessTime),
      buckets: resultBuckets(businessTime),
    },
    query_notes: notes,
    display_notes: displayNotes,
  };
  return {
    block,
    sampleForModel: true,
    sourceSemantics,
    resolvedDeliveryColumns,
    ...(truncated && !groupingPlan.calculations.length ? { exportPlan: queryPlan } : {}),
  };
}

export type QueryExecutionDependencies = {
  cube: CubeGateway;
  exports: Pick<ExportService, "createDelivery">;
};

export function createQueryExecutionService(deps: QueryExecutionDependencies) {
  const execute = (planned: AuthorizedAnalysisPlan): Promise<QueryRunResult> =>
    runQueryPipeline(
      {
        executeView: (...args) => executeView(deps, ...args),
        exports: deps.exports,
      },
      planned.access,
      planned.plan,
      planned.presentation,
    );
  return { execute };
}
