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
  incompatible_dimensions: ["dimension:department_name"],
};
const dimension: CatalogMemberPayload = {
  id: "dimension:department_name",
  kind: "dimension",
  title: "部门",
  description: "部门名称。",
  dimension_group: { id: "organization", title: "组织与部门" },
};

describe("report editor member picker", () => {
  test("候选本地灰化只据纯语义信号：互斥维度与被封锁维度，双向置灰", () => {
    expect(pickableMembers([measure], ["dimension:department_name"], [])[0]).toMatchObject({
      canonical_name: measure.id,
      incompatible: true,
    });
    expect(pickableMembers([dimension], [], ["dimension:department_name"])[0]).toMatchObject({
      canonical_name: dimension.id,
      incompatible: true,
    });
    // 无冲突信号时可选——跨来源可行性交由提交时的服务端预览编译裁定
    expect(pickableMembers([dimension], [], [])[0].incompatible).toBe(false);
  });

  // 分节靠服务端当前语义包投影的业务属性组驱动，身份使用公共语义 id：
  // JSON 形状或归组口径一旦漂移，这条必须炸，而不是静默退回一个「其他」大桶。
  test("维度按业务属性组分节，事实属性组优先于所属 cube 兜底", () => {
    const dimension = (id: string, title: string): CatalogMemberPayload => ({
      id,
      kind: "dimension",
      title,
      description: "",
      ...(id === "dimension:job_level_band"
        ? { dimension_group: { id: "job_and_level", title: "岗位与职级" } }
        : id === "dimension:gender"
          ? { dimension_group: { id: "employee_basic_info", title: "员工基本信息" } }
          : id === "dimension:organization_name"
            ? { dimension_group: { id: "organization", title: "组织与部门" } }
            : id === "dimension:leave_type"
              ? { dimension_group: { id: "termination_event", title: "离职记录属性" } }
              : {}),
    });
    const grouped = groupMembers(
      pickableMembers(
        [
          dimension("dimension:job_level_band", "职级段"),
          dimension("dimension:gender", "性别"),
          dimension("dimension:organization_name", "组织"),
          dimension("dimension:leave_type", "离职性质"),
          measure,
        ],
        [],
        [],
      ),
    );
    expect(grouped.map((group) => group.label)).toEqual([
      "岗位与职级",
      "员工基本信息",
      "组织与部门",
      "离职记录属性",
      "其他",
    ]);
    expect(grouped[0].items.map((item) => item.id)).toEqual(["dimension:job_level_band"]);
    // 归不进任何组的维度才落末位兜底桶——模型归组是 fail-closed 的，真成员不该走到这里。
    expect(
      groupMembers(pickableMembers([dimension("dimension:nowhere", "无归属")], [], [])),
    ).toEqual([{ label: "其他", items: expect.any(Array) }]);
  });

  test("指标按指标域分节只为找得到：组序取目录里域的次序，一指标多域取先出现的域", () => {
    const m = (id: string, title: string): CatalogMemberPayload => ({
      id,
      kind: "measure",
      title,
      description: "",
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
      pickableMembers(
        [
          m("measure:fulfillment", "编制完成率"),
          m("measure:turnover", "离职人数"),
          m("measure:orphan", "无域指标"),
          m("measure:headcount", "在职人数"),
          dimension,
        ],
        [],
        [],
      ),
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
