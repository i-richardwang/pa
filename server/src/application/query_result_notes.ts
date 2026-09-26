import type { CompletedQuery } from "../engine/hierarchy.js";
import { memberDisplayTitle, showDimensionNote } from "../engine/member_presentation.js";
import type { MetricSelectionOutcome, ResolvedMetricLoad } from "../engine/metric_calculator.js";
import type { CubeMember, CubeView } from "../ports/cube_gateway.js";
import type { Principal } from "../contracts/principal.js";
import type { QueryNote } from "../semantic_core/query_payload.js";
import { memberShortName } from "../semantic_core/member_name.js";

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

export function appendQueryNote(note: { text: string }, value: string): void {
  note.text = note.text ? `${note.text}（${value}）` : value;
}

function hierarchyAdditionTitles(
  views: CubeView[],
  addition: CompletedQuery["added"][number],
): { upperTitle: string; lowerTitles: string[] } {
  return {
    upperTitle: memberDisplayTitle(views, addition.member, memberShortName(addition.member)),
    lowerTitles: addition.children.map((child) =>
      memberDisplayTitle(views, child, memberShortName(child)),
    ),
  };
}

export function buildResultNotes(input: {
  views: CubeView[];
  principal: Principal;
  accessScopeTitle: string;
  load: Pick<ResolvedMetricLoad, "annotation" | "masked">;
  selection?: MetricSelectionOutcome;
  hierarchyAdditions: CompletedQuery["added"];
}): { queryNotes: QueryNote[]; displayNotes: QueryNote[] } {
  const { views, principal, accessScopeTitle, load, selection, hierarchyAdditions } = input;
  const annotations = [
    ...Object.entries(load.annotation.measures).map(([name, value]) => ({
      name,
      value,
      kind: "measure" as const,
    })),
    ...Object.entries(load.annotation.dimensions).map(([name, value]) => ({
      name,
      value,
      kind: "dimension" as const,
    })),
  ];
  const visibleMembers = views.flatMap((view) => [...view.measures, ...view.dimensions]);
  const queryNotes: QueryNote[] = annotations.map(({ name, value }) => ({
    member: name,
    title: memberDisplayTitle(views, name, value.title),
    text: agentDescription(visibleMembers, name, value.description ?? ""),
  }));
  const displayNotes: QueryNote[] = annotations
    .map(({ name, value, kind }) => ({
      member: name,
      title: memberDisplayTitle(views, name, value.title),
      text: displayDescription(visibleMembers, name, kind),
    }))
    .filter((note) => note.text);

  if (selection) {
    const by = visibleMembers.find((member) => member.name === selection.by);
    const dimensionTitles = selection.dimensions.map((name) => {
      const member = visibleMembers.find((candidate) => candidate.name === name);
      return memberDisplayTitle(views, name, member?.title ?? memberShortName(name));
    });
    const rankingTitle = memberDisplayTitle(
      views,
      selection.by,
      by?.title ?? memberShortName(selection.by),
    );
    const selectionRule =
      selection.window === "anchor"
        ? `按最近一个时间段的「${rankingTitle}」保留数值${selection.direction === "desc" ? "最高" : "最低"}的 ${selection.requestedCount} 个`
        : `按「${rankingTitle}」名称保留${selection.direction === "asc" ? "最靠前" : "最靠后"}的 ${selection.requestedCount} 个`;
    const text =
      `结果${selectionRule}「${dimensionTitles.join("、")}」分组，实际选中 ${selection.selectedCount} 个；` +
      (selection.window === "anchor"
        ? "其他时间段只显示这些分组，不参与排名。"
        : "所有时间段都只显示这些分组。");
    queryNotes.push({ member: "notice:top_n_selection", title: "分组选择", text });
    displayNotes.push({ member: "notice:top_n_selection", title: "结果范围", text });
  }

  for (const mask of load.masked ?? []) {
    const member = visibleMembers.find((candidate) => candidate.name === mask.member);
    const title = memberDisplayTitle(
      views,
      mask.member,
      member?.title ?? memberShortName(mask.member),
    );
    const note = {
      member: `notice:minimum_support:${memberShortName(mask.member)}`,
      title: "样本量不足",
      text: `「${title}」有 ${mask.groups} 个结果格的样本量少于 ${mask.threshold}，这些数值已隐藏。`,
    };
    queryNotes.push(note);
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

  const additions = new Map(
    hierarchyAdditions.map((addition) => [memberShortName(addition.member), addition]),
  );
  for (const note of queryNotes) {
    const addition = additions.get(memberShortName(note.member));
    if (!addition) continue;
    const relation = hierarchyAdditionTitles(views, addition);
    const lowerTitles = relation.lowerTitles.map((title) => `「${title}」`).join("、");
    appendQueryNote(
      note,
      `「${relation.upperTitle}」由系统自动带出，用于区分可能重名但属于不同上级的${lowerTitles}`,
    );
  }
  for (const addition of hierarchyAdditions) {
    const source = queryNotes.find(
      (note) => memberShortName(note.member) === memberShortName(addition.member),
    );
    if (!source) continue;
    const relation = hierarchyAdditionTitles(views, addition);
    const lowerTitles = relation.lowerTitles.map((title) => `「${title}」`).join("、");
    displayNotes.push({
      member: addition.member,
      title: memberDisplayTitle(views, source.member, source.title),
      text: `为区分可能重名的${lowerTitles}，结果已按「${relation.upperTitle}」拆分。`,
    });
  }

  if (principal.accessScope.kind === "limited") {
    const values = principal.accessScope.values.join("、") || "无可用值";
    queryNotes.push({
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

  return { queryNotes, displayNotes };
}
