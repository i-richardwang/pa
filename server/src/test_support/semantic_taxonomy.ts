import type { SemanticTaxonomy } from "../semantic_core/semantic_taxonomy.js";
import { buildTimeSourceRegistry } from "../semantic_core/time_source.js";

export const TEST_TIME_SOURCE_REGISTRY = buildTimeSourceRegistry([
  {
    id: "workforce",
    title: "人员数据",
    role: "actual",
    primary: true,
    comparison_policy: "calendar",
  },
  {
    id: "headcount_plan",
    title: "人员与编制数据",
    role: "plan",
    primary: false,
    reference_source: "workforce",
    comparison_policy: "calendar",
  },
]);

/** 通用目录装配夹具；业务默认 taxonomy 只能来自语义包，不能来自核心。 */
export const TEST_SEMANTIC_TAXONOMY: SemanticTaxonomy = {
  metric_domains: [
    {
      id: "metric_domain:workforce_structure",
      title: "人员规模与结构",
      description: "支持按组织、部门和通用员工属性分析月末人数、结构与平均特征。",
      time_source: "workforce",
      synonyms: ["人员规模", "人员结构", "在职人数", "平均特征"],
    },
    {
      id: "metric_domain:workforce_movement",
      title: "人员流动",
      description: "支持按组织、部门和通用员工属性分析入职、离职及相关比率。",
      time_source: "workforce",
      synonyms: ["人员流动", "人员流入", "人员流出", "入职", "离职", "离职率"],
    },
    {
      id: "metric_domain:headcount_plan",
      title: "编制计划与完成",
      description: "支持按组织和部门分析月度编制目标及完成率。",
      time_source: "headcount_plan",
      synonyms: ["人员编制", "编制计划", "编制完成", "编制完成率"],
    },
  ],
  dimension_groups: [
    {
      name: "organization",
      title: "组织与部门",
      description: "统计记录所属的组织与部门。",
    },
    {
      name: "employee_basic_info",
      title: "员工基本信息",
      description: "员工在记录时点的通用人口统计属性。",
    },
    {
      name: "job_and_level",
      title: "岗位与职级",
      description: "员工在记录时点的通用岗位与职级属性。",
    },
    {
      name: "termination_event",
      title: "离职记录属性",
      description: "离职事件对应的通用分类属性。",
    },
  ],
};
