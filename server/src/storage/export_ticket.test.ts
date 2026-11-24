import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExportTicketStore } from "./export_ticket.js";
import type { MetricQueryPlan } from "../engine/metric_planner.js";
import type { PlannedQuery } from "../engine/time_plan.js";
import { createTestAppDatabase } from "../test_support/app_database.js";

const planned = (query: PlannedQuery["query"]): PlannedQuery => ({
  query,
  time: {
    view: "test_people_metrics",
    windows: [{ from: "2026-07-01", to: "2026-07-31" }],
  },
  businessTime: {
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
});

const metricPlan = (query: PlannedQuery["query"]): MetricQueryPlan => {
  const { businessTime, ...leg } = planned(query);
  const measures = query.measures ?? [];
  const dimensions = query.dimensions ?? [];
  const metricId = (member: string) => `measure:${member.split(".").at(-1)}`;
  return {
    kind: "metric_query",
    business_time: businessTime,
    time_view: leg.time.view,
    legs: [
      {
        source_view: leg.time.view,
        plan: leg,
        dimensions: Object.fromEntries(dimensions.map((member) => [member, member])),
        measures: Object.fromEntries(measures.map((member) => [member, metricId(member)])),
      },
    ],
    nodes: Object.fromEntries(
      measures.map((member) => [metricId(member), { kind: "aggregate", member }]),
    ),
    dimensions,
    measures,
    output_metric_ids: Object.fromEntries(measures.map((member) => [member, metricId(member)])),
    ...(query.order ? { order: query.order } : {}),
  };
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(now = Date.UTC(2026, 6, 14)) {
  const dir = mkdtempSync(join(tmpdir(), "pa-export-ticket-"));
  dirs.push(dir);
  let clock = now;
  const dbPath = join(dir, "app.db");
  const db = createTestAppDatabase(dbPath);
  const store = createExportTicketStore(db, {
    ttlMs: 60_000,
    now: () => clock,
  });
  return { store, db, advance: (ms: number) => (clock += ms) };
}

describe("导出短票据", () => {
  test("票据 id 随机生成、不含 caller 或查询内容，解析后还原完整计划", async () => {
    const { store } = fixture();
    const plan = metricPlan({
      measures: ["test_people_metrics.active_employee_count"],
      filters: [],
    });
    const ticket = await store.create(plan, "tester@example.com");

    expect(ticket.id).toMatch(/^e_[A-Za-z0-9_-]{32}$/);
    expect(ticket.id).not.toContain("tester");
    expect(ticket.id.length).toBe(34);
    const claims = await store.resolve(ticket.id);
    expect(claims?.caller).toBe("tester@example.com");
    expect(claims?.plan).toEqual(plan);
    expect(claims).not.toHaveProperty("securityContext");
  });

  test("过期与非法票据均拒绝", async () => {
    const { store, advance } = fixture();
    const ticket = await store.create(
      metricPlan({ dimensions: ["individual_fixture.employee_name"] }),
      "tester",
    );
    expect(await store.resolve("not-a-ticket")).toBeNull();
    advance(60_001);
    expect(await store.resolve(ticket.id)).toBeNull();
  });

  test("重放票据只接受有效的视图引用", async () => {
    const { store, db } = fixture();
    const plan = { kind: "analysis_view" as const, view_id: crypto.randomUUID() };
    const { id } = await store.create(plan, "owner");
    expect(await store.resolve(id)).toEqual({ plan, caller: "owner" });
    for (const invalid of [
      { ...plan, view_id: "" },
      { ...plan, unexpected: true },
    ]) {
      db.prepare("UPDATE export_ticket SET query = ? WHERE id = ?").run(
        JSON.stringify(invalid),
        id,
      );
      expect(await store.resolve(id)).toBeNull();
    }
  });

  test("持久化的查询是合法 JSON 但结构不完整时解析返回空", async () => {
    const { store, db } = fixture();
    const ticket = await store.create(
      metricPlan({ measures: ["test_people_metrics.active_employee_count"] }),
      "tester",
    );
    db.prepare("UPDATE export_ticket SET query = ? WHERE id = ?").run(
      JSON.stringify({ query: {}, time: { view: "test_people_metrics" } }),
      ticket.id,
    );
    expect(await store.resolve(ticket.id)).toBeNull();
  });
});
