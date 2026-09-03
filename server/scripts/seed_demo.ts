/** 为公开虚构数据播种可执行报告、看板与通用业务术语。 */
import { randomUUID } from "node:crypto";
import { createBusinessTermRegistry } from "../src/application/business_term_registry.js";
import { createCatalogService } from "../src/application/catalog_service.js";
import { createQueryExecutionService } from "../src/application/query_execution_service.js";
import { createSemanticPlanningService } from "../src/application/semantic_planning_service.js";
import { createCubeGateway } from "../src/adapters/cube_gateway.js";
import { SERVICE_CUBE_CONTEXT } from "../src/engine/cube_security.js";
import type { Principal } from "../src/contracts/principal.js";
import { withFormalMetricModel } from "../src/engine/formal_metric_gateway.js";
import {
  loadCanonicalSemanticModel,
  withCanonicalSemanticModel,
} from "../src/engine/canonical_semantic_model.js";
import type {
  AnalysisDefinition,
  SemanticViewIntent,
} from "../src/semantic_core/semantic_analysis.js";
import {
  configuredSemanticPackageDir,
  loadSemanticPackage,
} from "../src/engine/semantic_package.js";
import { openAppDatabase } from "../src/storage/app_database.js";
import { createAnalysisRepository } from "../src/storage/analysis_repository.js";
import type { Place } from "../src/contracts/board_contract.js";
import { createBoardRepository } from "../src/storage/board_repository.js";
import { createBusinessTermRepository } from "../src/storage/business_term_repository.js";
import { createReportRepository } from "../src/storage/report_repository.js";
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
    accessScopeId: semanticPackage.access_scope.id,
    serviceContext: SERVICE_CUBE_CONTEXT,
    timeSources: semanticPackage.time_sources,
  }),
  semanticPackage.formal_metrics,
);
const canonical = await loadCanonicalSemanticModel({
  semantic_package: semanticPackage,
  cube: visibilityCube,
  service_context: SERVICE_CUBE_CONTEXT,
});
const cube = withCanonicalSemanticModel(visibilityCube, canonical);
const appDb = await openAppDatabase(dbPath);
try {
  const businessTermRegistry = createBusinessTermRegistry({
    repository: createBusinessTermRepository(appDb),
  });
  const catalog = createCatalogService({
    cube: visibilityCube,
    canonical,
    businessTerms: businessTermRegistry,
  });
  const planning = createSemanticPlanningService({ catalog });
  const execution = createQueryExecutionService({
    cube,
    exports: {
      createDelivery: async () => {
        throw new Error("Demo 播种不创建导出");
      },
    },
  });
  const principal: Principal = {
    email: owner,
    roles: ["admin"],
    accessScope: { kind: "all" },
  };
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
  const hireRate = measure("月度入职率");
  const turnoverRate = measure("月度离职率");
  const planned = measure("计划编制");
  const fulfillment = measure("编制达成率");
  const q12Average = measure("Q12平均得分");
  const q12Favorable = measure("Q12正向作答率");
  const q12Response = measure("Q12回复率");
  const q12Respondents = measure("Q12有效答卷人数");
  const q12BasicNeeds = measure("Q12基本需求得分");
  const q12IndividualContribution = measure("Q12个人贡献得分");
  const q12Teamwork = measure("Q12团队协作得分");
  const q12Growth = measure("Q12成长得分");
  const organization = dimension("组织");

  type DemoReport = {
    name: string;
    analysis: AnalysisDefinition;
    view: SemanticViewIntent;
  };
  const demos: DemoReport[] = [
    {
      name: "组织人员规模",
      analysis: {
        title: "按组织查看月末在职人数与平均年龄",
        queries: [
          {
            id: "workforce",
            measures: [active, averageAge],
            dimensions: [organization],
            time: { window: { kind: "current_month", month: asOf } },
            group_sort: { dimension: organization, by: active, direction: "desc" },
          },
        ],
      },
      view: { type: "table" },
    },
    {
      name: "入离职率趋势",
      analysis: {
        title: "本年逐月入职率与离职率趋势",
        queries: [
          {
            id: "movement",
            measures: [hireRate, turnoverRate],
            time: { window: { kind: "year_to_date", grain: "month" } },
          },
        ],
      },
      view: { type: "line", series: [hireRate, turnoverRate] },
    },
    {
      name: "组织编制达成率",
      analysis: {
        title: "按组织查看月末人数、计划编制与达成率",
        queries: [
          {
            id: "staffing",
            measures: [active, planned, fulfillment],
            dimensions: [organization],
            time: { window: { kind: "current_month", month: asOf } },
            group_sort: { dimension: organization, by: fulfillment, direction: "desc" },
          },
        ],
      },
      view: { type: "bar", category: organization, series: [fulfillment] },
    },
    {
      name: "Q12组织敬业度",
      analysis: {
        title: "按组织查看最近一期Q12得分、正向作答率与回复率",
        queries: [
          {
            id: "engagement",
            measures: [q12Average, q12Favorable, q12Response, q12Respondents],
            dimensions: [organization],
            time: { window: { kind: "current_month", month: asOf } },
            group_sort: { dimension: organization, by: q12Average, direction: "desc" },
          },
        ],
      },
      view: { type: "table" },
    },
    {
      name: "Q12层级得分",
      analysis: {
        title: "按组织比较最近一期Q12四个层级的平均得分",
        queries: [
          {
            id: "engagement_layers",
            measures: [q12BasicNeeds, q12IndividualContribution, q12Teamwork, q12Growth],
            dimensions: [organization],
            time: { window: { kind: "current_month", month: asOf } },
            group_sort: { dimension: organization, by: q12BasicNeeds, direction: "desc" },
          },
        ],
      },
      view: {
        type: "bar",
        category: organization,
        series: [q12BasicNeeds, q12IndividualContribution, q12Teamwork, q12Growth],
      },
    },
  ];

  const terms = await seed_demo_business_terms({
    registry: businessTermRegistry,
    members: [...document.measures, ...document.dimensions],
  });
  const analyses = createAnalysisRepository(appDb);
  const reports = createReportRepository(appDb);
  const existing = new Map(
    (await reports.listOwned(owner, undefined, "all")).map((report) => [report.name, report]),
  );
  const reportIds = new Map<string, string>();
  for (const demo of demos) {
    const compiled = await planning.plan(principal, demo.analysis, demo.view);
    const result = await execution.execute(compiled);
    if (!result.fullRowViewBlock.rows.length) throw new Error(`Demo「${demo.name}」实跑零行`);
    const analysis = await analyses.create(owner, demo.analysis, demo.view);
    const previous = existing.get(demo.name);
    const report = previous
      ? await reports.update(
          previous.id,
          owner,
          { name: demo.name, viewId: analysis.view.id, archivedAt: null },
          previous.revision,
        )
      : await reports.create({ owner, name: demo.name, viewId: analysis.view.id });
    reportIds.set(demo.name, report.id);
  }

  const placements = [
    ["组织人员规模", { x: 0, y: 0, w: 12, h: 8 }],
    ["入离职率趋势", { x: 12, y: 0, w: 12, h: 8 }],
    ["组织编制达成率", { x: 0, y: 8, w: 12, h: 7 }],
    ["Q12组织敬业度", { x: 12, y: 8, w: 12, h: 7 }],
    ["Q12层级得分", { x: 0, y: 15, w: 24, h: 8 }],
  ] satisfies [string, Place][];
  const tiles = placements.map(([name, place]) => {
    const reportId = reportIds.get(name);
    if (!reportId) throw new Error(`看板引用了未播种的报告：${name}`);
    return { kind: "report" as const, tile_id: randomUUID(), report_id: reportId, place };
  });
  const boards = createBoardRepository(appDb);
  const boardName = "公开 Demo 总览";
  // 认领含已删除的同名看板：删除可逆，重复播种不该在旁边再造一块。
  const previousBoard = (await boards.list("all")).find(
    (board) => board.name === boardName && board.created_by === owner,
  );
  if (previousBoard) {
    if (previousBoard.archived_at !== null) await boards.restore(previousBoard.id);
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
