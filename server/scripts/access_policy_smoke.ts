/** 公开 Demo 的 Cube access_policy 实链：组映射、组织范围和正式指标可见性。 */
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
if (semanticPackage.id !== "pa_demo") throw new Error("本冒烟只验证公开 pa_demo 包");
const cube = withFormalMetricModel(
  createCubeGateway({
    cubeUrl: process.env.CUBE_URL ?? "http://localhost:4000",
    apiSecret,
    serviceContext: SERVICE_CUBE_CONTEXT,
    timeSources: semanticPackage.time_sources,
  }),
  semanticPackage.formal_metrics,
);

const full: CubeSecurityContext = { subject: "full", groups: ["pa_full"], orgScope: "*" };
const unknown: CubeSecurityContext = {
  subject: "unknown",
  groups: ["unknown"],
  orgScope: "*",
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
assert((await cube.meta(unknown)).length === 0, "未知组不应看到任何 View");

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
assert(typeof scopedOrganization === "string", "全量身份没有可用于范围回归的组织");
const scoped: CubeSecurityContext = {
  subject: "scoped",
  groups: ["pa_scoped"],
  orgScope: [scopedOrganization],
};
const scopedNames = (await cube.meta(scoped)).map((view) => view.name).sort();
assert(
  JSON.stringify(scopedNames) === JSON.stringify(expectedViews),
  `受限身份公开 View 不完整：${scopedNames}`,
);
const scopedRows = (await cube.load(query, scoped)).data;
assert(fullRows.length >= 3, "全量身份应看到多个虚构组织");
assert(
  scopedRows.length === 1 &&
    scopedRows[0]?.["employee_snapshot_metrics.organization_name"] === scopedOrganization,
  "受限身份只能看到配置的虚构组织",
);
const sql = await cube.sql(query, scoped);
assert(
  sql.some((statement) => statement.params.includes(scopedOrganization)),
  "组织范围必须进入 Cube 生成 SQL 的参数",
);

const views = await cube.meta(scoped);
const hire = views.find((view) => view.name === "employee_hire_metrics");
assert(
  hire?.measures.some((measure) => measure.name.endsWith(".monthly_hire_rate")),
  "叶子指标可见时正式入职率应进入权限裁剪后的目录",
);
const q12 = views.find((view) => view.name === "q12_survey_response_metrics");
const q12Favorable = q12?.measures.find((measure) => measure.name.endsWith(".q12_favorable_rate"));
assert(q12Favorable, "Q12组件可见时正式正向作答率应进入权限裁剪后的目录");
assert(
  JSON.stringify(q12Favorable.meta?.result_guards) ===
    JSON.stringify([
      {
        kind: "minimum_support",
        support_measure: "q12_respondent_count",
        threshold: 5,
      },
    ]),
  "Q12正式指标必须保留最小支撑量保护合同",
);
console.log("公开 Demo access_policy 冒烟通过");
