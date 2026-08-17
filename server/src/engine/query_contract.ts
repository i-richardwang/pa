/**
 * 查询形态契约。跨事实边界由窄 View 的显式 includes 白名单决定；同一 View 内仍有
 * 少数指标专属限制（如年底编制不能下钻最细节点），由结构化元数据声明。
 */
import type {
  CubeFilter,
  CubeFilterCondition,
  CubeQuery,
  CubeView,
} from "../ports/cube_gateway.js";
import { memberShortName } from "../semantic_core/member_name.js";
import { isIndividualDimension } from "./model_contract.js";

const isCondition = (filter: CubeFilter): filter is CubeFilterCondition => "member" in filter;

type IncompatibleDimension = string | { member?: unknown; reason?: unknown };

export function filterMembers(filters: CubeFilter[] | undefined): string[] {
  const members: string[] = [];
  const visit = (filter: CubeFilter): void => {
    if (isCondition(filter)) members.push(filter.member);
    else for (const child of "and" in filter ? filter.and : filter.or) visit(child);
  };
  for (const filter of filters ?? []) visit(filter);
  return members;
}

function findMeasure(views: CubeView[], name: string) {
  return views.flatMap((view) => view.measures).find((measure) => measure.name === name);
}

function findDimension(views: CubeView[], name: string) {
  const dimensions = views.flatMap((view) => view.dimensions);
  return (
    dimensions.find((dimension) => dimension.name === name) ??
    dimensions.find((dimension) => memberShortName(dimension.name) === memberShortName(name))
  );
}

function singleValueEqualsMembers(filters: CubeFilter[] | undefined): string[] {
  const members: string[] = [];
  const visit = (filter: CubeFilter): void => {
    if (isCondition(filter)) {
      if (filter.operator === "equals" && filter.values?.length === 1) members.push(filter.member);
      return;
    }
    if ("and" in filter) for (const child of filter.and) visit(child);
    // OR 中任一腿的单值条件不代表整个查询已把该维度固定为单值。
  };
  for (const filter of filters ?? []) visit(filter);
  return members;
}

function sameMember(a: string, b: string): boolean {
  return a === b || memberShortName(a) === memberShortName(b);
}

function isTimeAxis(dimension: ReturnType<typeof findDimension>): boolean {
  if (!dimension) return false;
  return (
    dimension.type === "time" ||
    ["year", "month", "period_month"].includes(memberShortName(dimension.name))
  );
}

/** 发现不成立的查询形态即拒绝，避免返回有数值但业务含义已改变的结果。 */
export function assertMeasureFilterCompatibility(query: CubeQuery, views: CubeView[]): void {
  const filters = filterMembers(query.filters);
  const dimensions = [...(query.dimensions ?? []), ...filters];
  for (const measureName of query.measures ?? []) {
    const measure = findMeasure(views, measureName);
    if (measure?.meta?.calculation_role === "structure_share") {
      const fixed = singleValueEqualsMembers(query.filters);
      const grouped = (query.dimensions ?? []).map((name) => ({
        name,
        dimension: findDimension(views, name),
      }));
      if (grouped.some(({ dimension }) => isIndividualDimension(dimension))) {
        throw new Error(
          `指标「${measure.title ?? measureName}」不能用于人员名单；` +
            "结构占比只适用于职级、组织、序列等分类汇总。",
        );
      }
      const categoryDimensions = grouped.filter(({ name, dimension }) => {
        return !isTimeAxis(dimension) && !fixed.some((member) => sameMember(member, name));
      });
      if (!categoryDimensions.length) {
        const categoryNames = grouped
          .filter(({ dimension }) => !isTimeAxis(dimension))
          .map(({ name, dimension }) => `「${dimension?.title ?? name}」`)
          .join("、");
        throw new Error(
          `指标「${measure.title ?? measureName}」必须按至少一个未被单值筛选的分类维度分组；` +
            `当前分类维度${categoryNames || "已被筛选"}被固定为单值；` +
            "请保留分类的多个取值进行分组，不要先只筛选其中一个值，否则占比恒为 100%。",
        );
      }
    }
    const incompatible = measure?.meta?.incompatible_dimensions;
    if (!Array.isArray(incompatible)) continue;
    for (const raw of incompatible as IncompatibleDimension[]) {
      const forbidden = typeof raw === "string" ? raw : raw.member;
      if (typeof forbidden !== "string") continue;
      const hit = dimensions.find(
        (member) => member === forbidden || memberShortName(member) === memberShortName(forbidden),
      );
      if (!hit) continue;
      const dimension = findDimension(views, hit);
      const reason =
        typeof raw === "object" && raw !== null && typeof raw.reason === "string"
          ? `：${raw.reason}`
          : "";
      throw new Error(
        `指标「${measure?.title ?? measureName}」不能按维度「${dimension?.title ?? hit}」分组或筛选${reason}；` +
          "请移除该维度及其过滤，或调用 catalog 改选与该维度兼容的指标",
      );
    }
  }
}
