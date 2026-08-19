import { describe, expect, test } from "bun:test";
import type { MetricQueryPlan } from "../engine/metric_planner.js";
import type { CubeGateway } from "../ports/cube_gateway.js";
import type { Principal } from "../contracts/principal.js";
import type { AnalysisSpec } from "../semantic_core/analysis_spec.js";
import { exportableOutput, planExecution } from "../semantic_core/execution_plan.js";
import {
  createExportService,
  ExportIncompleteError,
  ExportTicketUnavailableError,
} from "./export_service.js";

const query = (id: string) => ({
  id,
  view_title: `查询结果 ${id}`,
  measures: ["test_people_metrics.active_employee_count"],
  time: {},
});

describe("export capability", () => {
  test("唯一结果是直查节点时可导出", () => {
    expect(exportableOutput(planExecution({ views: [query("only")] }))?.id).toBe("only");
  });

  test("唯一结果是派生节点时不可回退导出内部执行腿", () => {
    const spec: AnalysisSpec = {
      views: [
        query("source"),
        {
          id: "derived",
          view_title: "派生",
          from: ["source"],
          columns: [{ col: "active_employee_count", source: "source" }],
        },
      ],
    };
    const plan = planExecution(spec);
    expect(plan.output.id).toBe("derived");
    expect(exportableOutput(plan)).toBeUndefined();
  });

  test("多个独立终点不是合法分析", () => {
    expect(() => planExecution({ views: [query("first"), query("second")] })).toThrow(
      /一次分析只能回答一个问题/,
    );
  });
});

const plan: MetricQueryPlan = {
  kind: "metric_query",
  dimensions: [],
  measures: ["test_people_metrics.active_employee_count"],
  business_time: {
    outputGrain: "total",
    coordinates: [
      {
        kind: "cutoff",
        from: "2026-07",
        to: "2026-07",
        buckets: [{ from: "2026-07", to: "2026-07" }],
      },
    ],
  },
  time_view: "test_people_metrics",
  output_metric_ids: {
    "test_people_metrics.active_employee_count": "measure:active_employee_count",
  },
  nodes: {
    "measure:active_employee_count": {
      kind: "aggregate",
      member: "test_people_metrics.active_employee_count",
    },
  },
  legs: [
    {
      source_view: "test_people_metrics",
      dimensions: {},
      measures: {
        "test_people_metrics.active_employee_count": "measure:active_employee_count",
      },
      plan: {
        query: { measures: ["test_people_metrics.active_employee_count"] },
        time: {
          view: "test_people_metrics",
          windows: [{ from: "2026-07-01", to: "2026-07-31" }],
        },
      },
    },
  ],
};

const owner: Principal = { email: "owner@example.com", roles: ["user"], orgScope: "*" };

const cube = {
  meta: async () => [],
  load: async () => {
    throw new Error("测试不应直接执行 Cube 查询");
  },
  loadMulti: async () => [],
  sql: async () => [],
  timeContext: async () => ({ dataAsOf: "2026-07", sources: {} }),
} as CubeGateway;

function exportServiceFixture(input: {
  resolvedCaller?: string;
  runExport?: () => Promise<{
    csv: string;
    rowCount: number;
    asOf: string;
    complete: boolean;
  }>;
}) {
  const audits: unknown[] = [];
  let executions = 0;
  const service = createExportService({
    analyses: {
      resolveOwnedView: async () => {
        throw new Error("测试不创建分析导出");
      },
    },
    semanticPlanning: {
      plan: async () => {
        throw new Error("测试不编译分析");
      },
    },
    usage: { log: async () => undefined },
    cube,
    tickets: {
      create: async () => ({ id: "ticket", expires_at: "2026-07-31T00:00:00.000Z" }),
      resolve: async () =>
        input.resolvedCaller
          ? {
              plan,
              caller: input.resolvedCaller,
            }
          : null,
    },
    baseUrl: "https://pa.example",
    audit: async (event) => void audits.push(event),
    runExport: async () => {
      executions += 1;
      return (
        input.runExport?.() ??
        Promise.resolve({ csv: "csv", rowCount: 1, asOf: "2026-07", complete: true })
      );
    },
  });
  return { service, audits, executions: () => executions };
}

describe("export service", () => {
  test("签发链接和 MCP 资源时统一记录创建审计", async () => {
    const { service, audits } = exportServiceFixture({});
    const delivery = await service.createDelivery(plan, "owner@example.com");

    expect(delivery).toEqual({
      link: {
        url: "https://pa.example/export/ticket",
        expires_at: "2026-07-31T00:00:00.000Z",
      },
      resource: {
        type: "resource_link",
        uri: "pa://export/ticket",
        name: "pa_export.csv",
        mimeType: "text/csv; charset=utf-8",
      },
    });
    expect(audits).toEqual([{ event: "export_created", caller: "owner@example.com", query: plan }]);
  });

  test("MCP 资源必须属于当前主体，且拒绝发生在查询执行之前", async () => {
    const { service, executions } = exportServiceFixture({ resolvedCaller: "owner@example.com" });

    await expect(
      service.readResource(
        { email: "other@example.com", roles: ["viewer"], orgScope: "*" },
        "ticket",
      ),
    ).rejects.toBeInstanceOf(ExportTicketUnavailableError);
    expect(executions()).toBe(0);
  });

  test("下载成功与不完整结果分别记录唯一终态审计", async () => {
    const complete = exportServiceFixture({ resolvedCaller: "owner@example.com" });
    await expect(complete.service.readResource(owner, "ticket")).resolves.toEqual({
      csv: "csv",
      rowCount: 1,
      asOf: "2026-07",
    });
    expect(complete.audits).toEqual([
      {
        event: "export_downloaded",
        caller: "owner@example.com",
        query: plan,
        row_count: 1,
      },
    ]);

    const incomplete = exportServiceFixture({
      resolvedCaller: "owner@example.com",
      runExport: async () => ({ csv: "", rowCount: 50_000, asOf: "2026-07", complete: false }),
    });
    await expect(incomplete.service.readResource(owner, "ticket")).rejects.toBeInstanceOf(
      ExportIncompleteError,
    );
    expect(incomplete.audits).toEqual([
      {
        event: "export_failed",
        caller: "owner@example.com",
        query: plan,
        row_count: 50_000,
      },
    ]);
  });

  test("执行异常原样上抛并记录失败审计", async () => {
    const failure = new Error("Cube unavailable");
    const { service, audits } = exportServiceFixture({
      resolvedCaller: "owner@example.com",
      runExport: async () => {
        throw failure;
      },
    });

    await expect(service.readResource(owner, "ticket")).rejects.toBe(failure);
    expect(audits).toEqual([{ event: "export_failed", caller: "owner@example.com", query: plan }]);
  });
});
