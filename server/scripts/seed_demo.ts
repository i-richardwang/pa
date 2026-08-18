/** 为公开虚构数据播种可执行报告、看板与通用业务术语。 */
import { randomUUID } from "node:crypto";
import { createBusinessTermService } from "../src/application/business_term_service.js";
import { createCatalogService } from "../src/application/catalog_service.js";
import { createQueryExecutionService } from "../src/application/query_execution_service.js";
import { createSemanticPlanningService } from "../src/application/semantic_planning_service.js";
import { createCubeGateway } from "../src/adapters/cube_gateway.js";
import { SERVICE_CUBE_CONTEXT, type Principal } from "../src/engine/cube_security.js";
import { withFormalMetricModel } from "../src/engine/formal_metric_gateway.js";
import {
  loadCanonicalSemanticModel,
  withCanonicalSemanticModel,
} from "../src/engine/canonical_semantic_model.js";
import type { SemanticAnalysisSpec } from "../src/semantic_core/semantic_analysis.js";
import {
  configuredSemanticPackageDir,
  loadSemanticPackage,
} from "../src/engine/semantic_package.js";
import { openAppDatabase } from "../src/storage/app_database.js";
import { createAnalysisRepository } from "../src/storage/analysis_repository.js";
import { createBoardRepository, type Place } from "../src/storage/board_repository.js";
import { createBusinessTermRepository } from "../src/storage/business_term_repository.js";
import { createReportRepository } from "../src/storage/report_repository.js";
import { createUsageLog } from "../src/storage/usage_log.js";
import { seed_demo_business_terms } from "./demo_business_terms.js";

const apiSecret = process.env.CUBEJS_API_SECRET;
if (!apiSecret) throw new Error("缺少 CUBEJS_API_SECRET");
const owner = process.argv[2] ?? "demo@pa.local";
const dbPath = process.env.PA_APP_DB ?? "data/app.db";
const semanticPackage = await loadSemanticPackage(configuredSemanticPackageDir());
if (semanticPackage.id !== "pa_demo") {
  throw new Error("seed:demo 只对公开 pa_demo 语义包生效，内部包应维护自己的播种适配器");
}

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
const execution = createQueryExecutionService({
  cube,
  exports: {
    createDelivery: async () => {
      throw new Error("Demo 播种不创建导出");
    },
  },
});
const principal: Principal = { email: owner, roles: ["admin"], orgScope: "*" };
const document = await catalog.publicDocument(principal);
const timeContext = await cube.timeContext();
const asOf = timeContext.dataAsOf;

const measure = (title: string): string => {
  const member = document.measures.find((candidate) => candidate.title === title);
  if (!member) throw new Error(`公开 Demo 目录缺少指标：${title}`);
  return member.id;
};
const dimension = (title: string): string => {
  const member = document.dimensions.find((candidate) => candidate.title === title);
  if (!member) throw new Error(`公开 Demo 目录缺少维度：${title}`);
  return member.id;
};

const active = measure("在职人数");
const averageAge = measure("平均年龄");
const hireRate = measure("本月入职率");
const turnoverRate = measure("本月离职率");
const planned = measure("编制目标");
const fulfillment = measure("当月编制完成率");
const organization = dimension("组织");

type DemoReport = { name: string; spec: SemanticAnalysisSpec };
const demos: DemoReport[] = [
  {
    name: "组织人员规模",
    spec: {
      version: 2,
      analysis: {
        title: "按组织查看月末在职人数与平均年龄",
        views: [
          {
            id: "workforce",
            measures: [active, averageAge],
            dimensions: [organization],
            time: { window: { kind: "current_month", month: asOf } },
            group_sort: { dimension: organization, by: active, direction: "desc" },
          },
        ],
      },
      presentation: { type: "table" },
    },
  },
  {
    name: "入离职率趋势",
    spec: {
      version: 2,
      analysis: {
        title: "本年逐月入职率与离职率趋势",
        views: [
          {
            id: "movement",
            measures: [hireRate, turnoverRate],
            time: { window: { kind: "year_to_date" }, display: "month" },
          },
        ],
      },
      presentation: { type: "line", series: [hireRate, turnoverRate] },
    },
  },
  {
    name: "组织编制完成率",
    spec: {
      version: 2,
      analysis: {
        title: "按组织查看月末人数、编制目标与完成率",
        views: [
          {
            id: "staffing",
            measures: [active, planned, fulfillment],
            dimensions: [organization],
            time: { window: { kind: "current_month", month: asOf } },
            group_sort: { dimension: organization, by: fulfillment, direction: "desc" },
          },
        ],
      },
      presentation: { type: "bar", category: organization, series: [fulfillment] },
    },
  },
];

const appDb = await openAppDatabase(dbPath);
try {
  const terms = await seed_demo_business_terms({
    service: createBusinessTermService({
      repository: createBusinessTermRepository(appDb),
      usage: createUsageLog(appDb),
    }),
    members: [...document.measures, ...document.dimensions],
  });
  const analyses = createAnalysisRepository(appDb);
  const reports = createReportRepository(appDb);
  const existing = new Map(
    (await reports.listOwned(owner, undefined, true)).map((report) => [report.name, report]),
  );
  const reportIds = new Map<string, string>();
  for (const demo of demos) {
    const compiled = await planning.compile(principal, demo.spec);
    const result = await execution.execute(principal, compiled.plan, compiled.presentation);
    if (!result.fullRowViewBlock.rows.length) throw new Error(`Demo「${demo.name}」实跑零行`);
    const analysis = await analyses.create(owner, demo.spec);
    const previous = existing.get(demo.name);
    const report = previous
      ? await reports.update(
          previous.id,
          owner,
          { name: demo.name, analysisId: analysis.id, archivedAt: null },
          previous.revision,
        )
      : await reports.create({ owner, name: demo.name, analysisId: analysis.id });
    reportIds.set(demo.name, report.id);
  }

  const placements = [
    ["组织人员规模", { x: 0, y: 0, w: 12, h: 8 }],
    ["入离职率趋势", { x: 12, y: 0, w: 12, h: 8 }],
    ["组织编制完成率", { x: 0, y: 8, w: 12, h: 7 }],
  ] satisfies [string, Place][];
  const tiles = placements.map(([name, place]) => {
    const reportId = reportIds.get(name);
    if (!reportId) throw new Error(`看板引用了未播种的报告：${name}`);
    return { kind: "report" as const, tile_id: randomUUID(), report_id: reportId, place };
  });
  const boards = createBoardRepository(appDb, reports);
  const boardName = "公开 Demo 总览";
  const previousBoard = (await boards.list()).find(
    (board) => board.name === boardName && board.created_by === owner,
  );
  if (previousBoard) {
    await boards.update(previousBoard.id, { tiles }, previousBoard.revision);
  } else {
    const board = await boards.create(boardName, owner);
    await boards.update(board.id, { tiles }, board.revision);
  }
  console.log(
    `Demo 就绪：${demos.length} 个报告，业务术语新增 ${terms.created.length} 条、保留 ${terms.preserved.length} 条；数据截止 ${asOf}。`,
  );
} finally {
  appDb.close();
}
