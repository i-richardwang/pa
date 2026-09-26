import { describe, expect, test } from "bun:test";
import type {
  PublicCatalogMember as CatalogMemberPayload,
  PublicMetricDomain as MetricDomainPayload,
} from "@contracts/catalog_contract";
import { groupMembers, metricDomainTitles, pickableMembers } from "./member_picker";

const measure: CatalogMemberPayload = {
  id: "measure:period_end_target_count",
  kind: "measure",
  title: "期末目标数",
  description: "期末配置的目标数量。",
  query_capabilities: { dimension_ids: [] },
  time: { value_basis: "bucket_end" as const },
};
const dimension: CatalogMemberPayload = {
  id: "dimension:department_name",
  kind: "dimension",
  title: "部门",
  description: "部门名称。",
  dimension_group: { id: "organization", title: "组织与部门" },
};

describe("report editor member picker", () => {
  test("候选成员的不可选原因取自传入的可行性判定", () => {
    expect(
      pickableMembers([measure], () => "当前时间按年呈现，该指标只支持按月呈现")[0],
    ).toMatchObject({
      incompatible: true,
      incompatible_reason: "当前时间按年呈现，该指标只支持按月呈现",
    });
    expect(pickableMembers([dimension])[0].incompatible).toBe(false);
  });

  // 目录的 dimension_group 格式或归组变化时本用例应失败，而不是让维度全部落进「其他」组。
  test("维度按业务属性组分组，没有分组的成员归入「其他」", () => {
    const dimension = (
      id: string,
      title: string,
      group: { id: string; title: string },
    ): CatalogMemberPayload => ({
      id,
      kind: "dimension",
      title,
      description: "",
      dimension_group: group,
    });
    const grouped = groupMembers(
      pickableMembers([
        dimension("dimension:job_level_band", "职级段", {
          id: "job_and_level",
          title: "岗位与职级",
        }),
        dimension("dimension:gender", "性别", {
          id: "employee_basic_info",
          title: "员工基本信息",
        }),
        dimension("dimension:organization_name", "组织", {
          id: "organization",
          title: "组织与部门",
        }),
        dimension("dimension:leave_type", "离职性质", {
          id: "termination_event",
          title: "离职记录属性",
        }),
        measure,
      ]),
    );
    expect(grouped.map((group) => group.label)).toEqual([
      "岗位与职级",
      "员工基本信息",
      "组织与部门",
      "离职记录属性",
      "其他",
    ]);
    expect(grouped[0].items.map((item) => item.id)).toEqual(["dimension:job_level_band"]);
  });

  test("指标按指标域分组：组顺序取目录中域的顺序，属于多个域的指标归入先出现的域", () => {
    const m = (id: string, title: string): CatalogMemberPayload => ({
      id,
      kind: "measure",
      title,
      description: "",
      query_capabilities: { dimension_ids: [] },
      time: { value_basis: "bucket_end" as const },
    });
    const domain = (id: string, title: string, measure_ids: string[]): MetricDomainPayload => ({
      id: id as MetricDomainPayload["id"],
      title,
      synonyms: [],
      measure_ids,
      dimension_ids: [],
    });
    const domains = [
      domain("metric_domain:workforce_structure", "人员规模与结构", ["measure:headcount"]),
      domain("metric_domain:workforce_movement", "人员流动", [
        "measure:turnover",
        "measure:headcount",
      ]),
      domain("metric_domain:headcount_plan", "编制计划与完成", ["measure:fulfillment"]),
    ];
    const grouped = groupMembers(
      pickableMembers([
        m("measure:fulfillment", "编制完成率"),
        m("measure:turnover", "离职人数"),
        m("measure:orphan", "无域指标"),
        m("measure:headcount", "在职人数"),
        dimension,
      ]),
      metricDomainTitles(domains),
    );
    expect(grouped.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ["人员规模与结构", ["measure:headcount"]],
      ["人员流动", ["measure:turnover"]],
      ["编制计划与完成", ["measure:fulfillment"]],
      ["组织与部门", ["dimension:department_name"]],
      ["其他", ["measure:orphan"]],
    ]);
  });
});
