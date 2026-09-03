/** 物理查询不变量。语义可行性在编译前判定，此层验证授权模型与执行计划保持一致。 */
import type {
  CubeFilter,
  CubeFilterCondition,
  CubeQuery,
  CubeView,
} from "../ports/cube_gateway.js";
import { memberShortName } from "../semantic_core/member_name.js";
import { parseIncompatibleDimensions } from "./incompatible_dimensions.js";

const isCondition = (filter: CubeFilter): filter is CubeFilterCondition => "member" in filter;

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

/** 语义可行性已放行的物理查询必须仍满足模型不变量；破裂表示规划或目录投影错误。 */
export function assertPhysicalQueryInvariants(query: CubeQuery, views: CubeView[]): void {
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
      const categoryDimensions = grouped.filter(({ name, dimension }) => {
        return !isTimeAxis(dimension) && !fixed.some((member) => sameMember(member, name));
      });
      if (!categoryDimensions.length) {
        const categoryNames = grouped
          .filter(({ dimension }) => !isTimeAxis(dimension))
          .map(({ name, dimension }) => `「${dimension?.title ?? name}」`)
          .join("、");
        throw new Error(
          `物理查询不变量失效：结构占比指标「${measure.title ?? measureName}」没有可变分类分组；` +
            `当前分类维度${categoryNames || "已被筛选"}被固定为单值`,
        );
      }
    }
    const incompatible = parseIncompatibleDimensions(
      measure?.meta?.incompatible_dimensions,
      `指标 ${measure?.title ?? measureName}`,
    );
    for (const item of incompatible) {
      const forbidden = item.member;
      const hit = dimensions.find(
        (member) => member === forbidden || memberShortName(member) === memberShortName(forbidden),
      );
      if (!hit) continue;
      const dimension = findDimension(views, hit);
      const reason = `：${item.reason}`;
      throw new Error(
        `物理查询不变量失效：指标「${measure?.title ?? measureName}」带有不兼容维度` +
          `「${dimension?.title ?? hit}」${reason}`,
      );
    }
  }
}
