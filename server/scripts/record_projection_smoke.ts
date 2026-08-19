/** 公开 Demo 的正式指标规划与受控记录投影实链。 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCubeGateway } from "../src/adapters/cube_gateway.js";
import { createCatalogService } from "../src/application/catalog_service.js";
import { createRecordProjectionService } from "../src/application/record_projection_service.js";
import { createSemanticPlanningService } from "../src/application/semantic_planning_service.js";
import { SERVICE_CUBE_CONTEXT } from "../src/engine/cube_security.js";
import type { Principal } from "../src/contracts/principal.js";
import { withFormalMetricModel } from "../src/engine/formal_metric_gateway.js";
import {
  loadCanonicalSemanticModel,
  withCanonicalSemanticModel,
} from "../src/engine/canonical_semantic_model.js";
import type { AnalysisDefinition } from "../src/semantic_core/semantic_analysis.js";
import {
  configuredSemanticPackageDir,
  loadSemanticPackage,
} from "../src/engine/semantic_package.js";
import { openAppDatabase } from "../src/storage/app_database.js";
import { createAnalysisRepository } from "../src/storage/analysis_repository.js";
import { createBoardRepository } from "../src/storage/board_repository.js";
import { createRecordProjectionAudit } from "../src/storage/record_projection_audit.js";
import { createReportRepository } from "../src/storage/report_repository.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const apiSecret = process.env.CUBEJS_API_SECRET;
if (!apiSecret) throw new Error("缺少 CUBEJS_API_SECRET");
const semanticPackage = await loadSemanticPackage(configuredSemanticPackageDir());
if (semanticPackage.id !== "pa_demo") throw new Error("本冒烟只验证公开 pa_demo 包");
const visibilityCube = withFormalMetricModel(
  createCubeGateway({
    cubeUrl: process.env.CUBE_URL ?? "http://localhost:4000",
    apiSecret,
    serviceContext: SERVICE_CUBE_CONTEXT,
  }),
  semanticPackage.formal_metrics,
);
const canonical = await loadCanonicalSemanticModel({
  semantic_package: semanticPackage,
  cube: visibilityCube,
  service_context: SERVICE_CUBE_CONTEXT,
});
const cube = withCanonicalSemanticModel(visibilityCube, canonical);
const catalog = createCatalogService({ cube: visibilityCube, canonical });
const planning = createSemanticPlanningService({ catalog });
const principal: Principal = {
  email: "records-demo@example.com",
  roles: ["user"],
  orgScope: ["Aurora Labs"],
};
const semanticContext = await catalog.context(principal);
const context = semanticContext.timeContext;
const compiler = semanticContext.compiler;
const active = compiler.measures.find((metric) => metric.title === "在职人数");
const organization = compiler.dimensions.find((dimension) => dimension.title === "组织");
assert(active?.records_available === true && organization, "在职人数或组织明细合同缺失");

const definition: AnalysisDefinition = {
  title: "公开 Demo 人员明细",
  views: [
    {
      id: "organization_summary",
      measures: [active.id],
      dimensions: [organization.id],
      time: { window: { kind: "current_month", month: context.dataAsOf } },
    },
  ],
};
const view = { type: "table" as const };
const compiled = await planning.plan(principal, definition, view);
assert(compiled.routes[0]?.status === "direct", "聚合查询未形成正式指标计划");
const binding = compiled.record_projection_bindings.views[0];
assert(binding, "分析没有生成记录投影绑定");

const appDb = await openAppDatabase(join(tmpdir(), `pa_demo_records_${randomUUID()}.db`));
try {
  const reports = createReportRepository(appDb);
  const analyses = createAnalysisRepository(appDb);
  const boards = createBoardRepository(appDb);
  const analysis = await analyses.create(principal.email, definition, view);
  const report = await reports.create({
    owner: principal.email,
    name: "公开 Demo 人员明细",
    viewId: analysis.view.id,
  });
  const records = createRecordProjectionService({
    reports,
    boards,
    analyses,
    semanticPlanning: planning,
    cube,
    audit: createRecordProjectionAudit(appDb),
  });
  const payload = await records.runReport(principal, report.id, {
    revision: report.revision,
    result_view_id: "organization_summary",
    metric_id: active.id,
    coordinates: [{ dimension_id: organization.id, value: "Aurora Labs" }],
    time_coordinate: { from: context.dataAsOf, to: context.dataAsOf },
    data_as_of: context.dataAsOf,
    offset: 0,
    limit: 5,
  });
  assert(payload.rows.length === 5, `预期 5 条虚构员工记录，实际 ${payload.rows.length}`);
  const organizationColumn = payload.columns.findIndex((column) => column.includes("组织"));
  assert(organizationColumn >= 0, "明细缺少组织列");
  assert(
    payload.rows.every((row) => row[organizationColumn] === "Aurora Labs"),
    "受限身份看到了授权组织之外的记录",
  );
  console.log("公开 Demo 记录投影冒烟通过");
} finally {
  appDb.close();
}
