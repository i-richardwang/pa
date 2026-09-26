/** 用真实 Cube 检查公开 Demo 的 access_policy：权限组映射、组织范围过滤和比率指标的可见性。 */
import { createCubeGateway } from "../src/adapters/cube_gateway.js";
import { SERVICE_CUBE_CONTEXT } from "../src/engine/cube_security.js";
import { withFormalMetricModel } from "../src/engine/formal_metric_gateway.js";
import type { CubeQuery, CubeSecurityContext } from "../src/ports/cube_gateway.js";
import {
  configuredSemanticPackageDir,
  loadSemanticPackage,
} from "../src/engine/semantic_package.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const apiSecret = process.env.CUBEJS_API_SECRET;
if (!apiSecret) throw new Error("缺少 CUBEJS_API_SECRET");
const semanticPackage = await loadSemanticPackage(configuredSemanticPackageDir());
if (semanticPackage.id !== "pa_demo") throw new Error("此检查只适用于公开 Demo 包 pa_demo");
const cube = withFormalMetricModel(
  createCubeGateway({
    cubeUrl: process.env.CUBE_URL ?? "http://localhost:4000",
    apiSecret,
    accessScopeId: semanticPackage.access_scope.id,
    serviceContext: SERVICE_CUBE_CONTEXT,
    timeSources: semanticPackage.time_sources,
  }),
  semanticPackage.formal_metrics,
);

const full: CubeSecurityContext = {
  subject: "full",
  groups: ["pa_full"],
  accessScope: { kind: "all" },
};
const unknown: CubeSecurityContext = {
  subject: "unknown",
  groups: ["unknown"],
  accessScope: { kind: "all" },
};
const expectedViews = [
  "employee_hire_metrics",
  "employee_hire_records",
  "employee_leave_metrics",
  "employee_leave_records",
  "employee_snapshot_metrics",
  "employee_snapshot_records",
  "headcount_plan_metrics",
  "q12_survey_participation_metrics",
  "q12_survey_response_metrics",
  "workforce_exposure_metrics",
];
const fullNames = (await cube.meta(full)).map((view) => view.name).sort();
assert(
  JSON.stringify(fullNames) === JSON.stringify(expectedViews),
  `公开 View 不完整：${fullNames}`,
);
assert((await cube.meta(unknown)).length === 0, "不属于任何授权组的账号不应看到 View");

const { dataAsOf } = await cube.timeContext();
const [year, month] = dataAsOf.split("-");
const query: CubeQuery = {
  measures: ["employee_snapshot_metrics.active_headcount"],
  dimensions: ["employee_snapshot_metrics.organization_name"],
  filters: [
    { member: "employee_snapshot_metrics.year", operator: "equals", values: [year] },
    { member: "employee_snapshot_metrics.month", operator: "equals", values: [String(+month)] },
  ],
};
const fullRows = (await cube.load(query, full)).data;
const scopedOrganization = fullRows[0]?.["employee_snapshot_metrics.organization_name"];
assert(typeof scopedOrganization === "string", "全量权限的账号没有查到任何组织，无法检查受限范围");
const scoped: CubeSecurityContext = {
  subject: "scoped",
  groups: ["pa_scoped"],
  accessScope: { kind: "limited", values: [scopedOrganization] },
};
const scopedNames = (await cube.meta(scoped)).map((view) => view.name).sort();
assert(
  JSON.stringify(scopedNames) === JSON.stringify(expectedViews),
  `受限权限的账号看到的 View 不完整：${scopedNames}`,
);
const scopedRows = (await cube.load(query, scoped)).data;
assert(fullRows.length >= 3, "全量权限的账号应看到多个组织");
assert(
  scopedRows.length === 1 &&
    scopedRows[0]?.["employee_snapshot_metrics.organization_name"] === scopedOrganization,
  "受限权限的账号应只看到授权的那个组织",
);
const sql = await cube.sql(query, scoped);
assert(
  sql.some((statement) => statement.params.includes(scopedOrganization)),
  "Cube 生成的 SQL 参数里应包含授权的组织",
);

const views = await cube.meta(scoped);
const hire = views.find((view) => view.name === "employee_hire_metrics");
assert(
  hire?.measures.some((measure) => measure.name.endsWith(".monthly_hire_rate")),
  "组成指标都可见时，入职率应出现在该账号的目录里",
);
const q12 = views.find((view) => view.name === "q12_survey_response_metrics");
const q12Favorable = q12?.measures.find((measure) => measure.name.endsWith(".q12_favorable_rate"));
assert(q12Favorable, "组成指标都可见时，Q12 正向作答率应出现在该账号的目录里");
assert(
  JSON.stringify(q12Favorable.meta?.result_guards) ===
    JSON.stringify([
      {
        kind: "minimum_support",
        support_measure: "q12_respondent_count",
        threshold: 5,
      },
    ]),
  "Q12 正向作答率应保留样本量少于 5 时隐藏数值的规则",
);
console.log("公开 Demo access_policy 检查通过");
