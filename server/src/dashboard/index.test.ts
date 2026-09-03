import { describe, expect, spyOn, test } from "bun:test";
import { createFeedbackService } from "../application/feedback_service.js";
import { InvalidRequestError } from "../application/errors.js";
import { cubeSecurityContext } from "../engine/cube_security.js";
import {
  PUBLIC_CATALOG_DOCUMENT_SCHEMA as CATALOG_PAYLOAD_SCHEMA,
  CATALOG_DIMENSION_VALUES_SCHEMA as CATALOG_VALUES_PAYLOAD_SCHEMA,
} from "../contracts/catalog_contract.js";
import { ME_PAYLOAD_SCHEMA } from "../contracts/session_contract.js";
import { MY_ANALYSES_PAYLOAD_SCHEMA } from "../contracts/analysis_contract.js";
import { USAGE_OVERVIEW_PAYLOAD_SCHEMA } from "../contracts/usage_contract.js";
import {
  buildDashboardApp as buildApp,
  createFeedbackStore,
  createTestAppDatabase,
  dashboardTestDependencies,
  dashboardRoutes,
  freshPath,
  seedUsage as seed,
} from "../test_support/dashboard.js";
import type { DashboardDependencies } from "./types.js";
import { AnalysisDefinitionError } from "../semantic_core/semantic_analysis.js";

function dashboardApp(
  user: Parameters<typeof dashboardTestDependencies>[0],
  overrides: Partial<DashboardDependencies> = {},
) {
  return dashboardRoutes(dashboardTestDependencies(user, freshPath(), overrides));
}

describe("dashboard app routes and access control", () => {
  test("未登录：页面 302 到登录页带回跳，API 401", async () => {
    const app = buildApp(null);
    const page = await app.request("/");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/login?redirect=/dashboard");
    const api = await app.request("/api/me");
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({
      error: { code: "unauthorized", message: "未登录" },
    });
    expect((await app.request("/api/usage/mine")).status).toBe(401);
    expect((await app.request("/api/usage/overview")).status).toBe(401);
  });

  test("普通用户：可进壳（me）与本人分析记录，管理端点 403", async () => {
    const app = buildApp({
      email: "u@x.com",
      name: "u",
      role: "user",
      access_scope: '{"scope_id":"organization","kind":"limited","values":["Aurora Labs"]}',
    });
    const me = await app.request("/api/me");
    expect(me.status).toBe(200);
    expect(ME_PAYLOAD_SCHEMA.parse(await me.json())).toMatchObject({
      email: "u@x.com",
      is_admin: false,
      access_scope: {
        id: "organization",
        kind: "limited",
        values: ["Aurora Labs"],
        title: "组织",
      },
    });
    expect((await app.request("/api/usage/mine")).status).toBe(200);
    expect((await app.request("/api/usage/overview")).status).toBe(403);
    expect((await app.request("/api/usage/titles")).status).toBe(403);
    expect((await app.request("/api/usage/unanswered")).status).toBe(403);
    expect((await app.request("/api/admin/data-capability-map")).status).toBe(403);
    // 行权限配置是 admin 专属
    const denied = await app.request("/api/users");
    expect(denied.status).toBe(403);
  });

  test("会话按语义包标题呈现非 HR 授权范围", async () => {
    const app = dashboardApp(
      {
        email: "regional@x.com",
        name: "regional",
        role: "user",
        access_scope: '{"scope_id":"region","kind":"limited","values":["North"]}',
      },
      { accessScopeDefinition: { id: "region", title: "Region" } },
    );
    const response = await app.request("/api/me");
    expect(response.status).toBe(200);
    expect(ME_PAYLOAD_SCHEMA.parse(await response.json()).access_scope).toEqual({
      id: "region",
      kind: "limited",
      values: ["North"],
      title: "Region",
    });
  });

  test("指标字典：PA 用户按同一 Principal 读取公共投影，真实值按需透传行权限", async () => {
    const contexts: unknown[] = [];
    const app = dashboardApp(
      {
        email: "h@x.com",
        name: "h",
        role: "user",
        access_scope:
          '{"scope_id":"organization","kind":"limited","values":["Aurora Labs","Harbor Works"]}',
      },
      {
        catalog: {
          publicDocument: async (context) => {
            contexts.push(context);
            return {
              access_scope: { id: "organization", title: "组织" },
              observation_scopes: ["统计范围"],
              data_as_of: "2026-07",
              time_context: [],
              metric_domains: [
                {
                  id: "metric_domain:workforce_movement" as const,
                  title: "人员流动",
                  query_contract: "含业务时间坐标的 Agent 说明",
                  synonyms: ["流失率"],
                  measure_ids: ["measure:ytd_primary_event_rate"],
                  dimension_ids: ["dimension:organization_name"],
                },
              ],
              measures: [
                {
                  id: "measure:ytd_primary_event_rate",
                  kind: "measure" as const,
                  title: "YTD主要事件率",
                  description: "主要事件数除以月均基数。",
                  ai_context: "只供 Agent",
                  query_capabilities: { dimension_ids: [] },
                },
              ],
              dimensions: [],
            };
          },
          dimensionValues: async (context, member, contains) => {
            contexts.push(context);
            expect(member).toBe("test_people_metrics.organization_name");
            expect(contains).toBe("网约");
            return {
              dimension: member,
              title: "组织",
              values: ["Aurora Labs"],
            };
          },
        },
      },
    );

    const catalog = await app.request("/api/catalog");
    expect(catalog.status).toBe(200);
    const payload = CATALOG_PAYLOAD_SCHEMA.parse(await catalog.json());
    expect(payload).toMatchObject({
      observation_scopes: ["统计范围"],
      metric_domains: [
        {
          title: "人员流动",
          query_contract: "含业务时间坐标的 Agent 说明",
          synonyms: ["流失率"],
        },
      ],
      measures: [{ title: "YTD主要事件率", ai_context: "只供 Agent" }],
    });
    expect(payload.metric_domains[0]).not.toHaveProperty("name");
    expect(payload.measures[0]).not.toHaveProperty("available_in");
    expect(payload.measures[0]).not.toHaveProperty("name");

    const values = await app.request(
      "/api/catalog/values?member=test_people_metrics.organization_name&contains=%E7%BD%91%E7%BA%A6",
    );
    expect(values.status).toBe(200);
    expect(CATALOG_VALUES_PAYLOAD_SCHEMA.parse(await values.json())).toMatchObject({
      values: ["Aurora Labs"],
    });
    expect(contexts).toEqual([
      {
        email: "h@x.com",
        roles: ["user"],
        accessScope: { kind: "limited", values: ["Aurora Labs", "Harbor Works"] },
      },
      {
        email: "h@x.com",
        roles: ["user"],
        accessScope: { kind: "limited", values: ["Aurora Labs", "Harbor Works"] },
      },
    ]);
  });

  test("指标字典：未登录 401、无数据角色 403、输入错误 400", async () => {
    expect((await buildApp(null).request("/api/catalog")).status).toBe(401);

    const wired = (role: string) =>
      dashboardApp(
        {
          email: `${role}@x`,
          name: role,
          role,
          access_scope: '{"scope_id":"organization","kind":"all"}',
        },
        {
          catalog: {
            publicDocument: async (principal) => {
              cubeSecurityContext(principal);
              throw new Error("不应调用");
            },
            dimensionValues: async () => {
              throw new InvalidRequestError("未开放值清单");
            },
          },
        },
      );
    expect((await wired("unknown").request("/api/catalog")).status).toBe(403);
    expect((await wired("user").request("/api/catalog/values")).status).toBe(400);
    expect(
      (await wired("user").request("/api/catalog/values?member=test_people_metrics.contract_type"))
        .status,
    ).toBe(400);
  });

  test("数据能力地图：仅管理员读取当前语义包投影", async () => {
    const capabilityMap = { facts: [], dimension_groups: [], metric_domains: [] };
    const routes = (role: string) =>
      dashboardApp({ email: `${role}@x`, name: role, role }, { capabilityMap });

    expect((await routes("user").request("/api/admin/data-capability-map")).status).toBe(403);
    const loaded = await routes("admin").request("/api/admin/data-capability-map");
    expect(loaded.status).toBe(200);
    expect(await loaded.json()).toEqual(capabilityMap);
  });

  test("管理员：角色与行权限通过同一个结构化用户管理用例更新", async () => {
    const updates: unknown[] = [];
    const app = dashboardApp(
      { email: "a@x.com", name: "a", role: "admin" },
      {
        userAdministration: () => ({
          list: async () => ({ users: [] }),
          create: async () => {
            throw new Error("不应创建");
          },
          updateAuthorization: async (principal, userId, input) => {
            updates.push({ principal, userId, input });
            return {
              id: userId,
              email: "u@x.com",
              name: "u",
              role: input.role,
              access_scope: input.access_scope,
              banned: false,
            };
          },
          resetPassword: async () => undefined,
        }),
      },
    );
    const res = await app.request("/api/users/u1/authorization", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "user",
        access_scope: { kind: "limited", values: [" Aurora Labs "] },
      }),
    });
    expect(res.status).toBe(200);
    expect(updates).toEqual([
      {
        principal: { email: "a@x.com", roles: ["admin"], accessScope: { kind: "all" } },
        userId: "u1",
        input: { role: "user", access_scope: { kind: "limited", values: ["Aurora Labs"] } },
      },
    ]);
  });

  test("全局错误边界覆盖未做局部捕获的 Dashboard 端点", async () => {
    const failure = new Error("SQLITE_CANTOPEN /private/path");
    const logged = spyOn(console, "error").mockImplementation(() => undefined);
    const app = dashboardApp(
      { email: "u@x", name: "u", role: "user" },
      {
        usage: {
          mine: async () => {
            throw failure;
          },
        } as never,
      },
    );
    try {
      const response = await app.request("/api/usage/mine");
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: { code: "internal", message: "服务暂时无法完成请求，请稍后重试" },
      });
      expect(logged).toHaveBeenCalledWith("[pa] dashboard 请求失败:", failure);
    } finally {
      logged.mockRestore();
    }
  });

  test("Web 分析输入错误保留可执行提示", async () => {
    const app = dashboardApp(
      { email: "u@x", name: "u", role: "user" },
      {
        analyses: {
          preview: async () => {
            throw new AnalysisDefinitionError("一次分析只能回答一个问题；请拆分分析");
          },
        } as never,
      },
    );
    const response = await app.request("/api/analyses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        analysis: {
          views: [
            {
              id: "result",
              measures: ["measure:active_employee_count"],
              time: { window: { kind: "current_month", month: "2026-07" } },
            },
          ],
        },
        view: { type: "table" },
        view_preferences: {},
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_request", message: "一次分析只能回答一个问题；请拆分分析" },
    });
  });

  test("本人分析记录：caller 锁定会话 email，只见自己不见他人", async () => {
    const path = freshPath();
    await seed(path);
    const asAlice = buildApp({ email: "alice", name: "alice", role: "user" }, path);
    const mine = await asAlice.request("/api/usage/mine");
    expect(mine.status).toBe(200);
    const payload = MY_ANALYSES_PAYLOAD_SCHEMA.parse(await mine.json());
    expect(payload.rows.map((r) => r.title)).toEqual([
      "全公司各职级人员结构",
      "研发部在职人数",
      "全公司各职级人员结构",
    ]);
    // 客户端传 caller 无效：仍按会话身份返回（这里会话是无分析记录的账号）
    const asOther = buildApp({ email: "nobody", name: "nobody", role: "user" }, path);
    expect(
      ((await (await asOther.request("/api/usage/mine?caller=alice")).json()) as { rows: [] }).rows,
    ).toEqual([]);
  });

  test("管理员：页面与全部使用日志端点可达（多角色串也识别）", async () => {
    const path = freshPath();
    await seed(path);
    const app = buildApp({ email: "a@x.com", name: "a", role: "user, admin " }, path);
    expect((await app.request("/")).status).toBe(200);
    const me = await app.request("/api/me");
    expect(ME_PAYLOAD_SCHEMA.parse(await me.json())).toMatchObject({ is_admin: true });
    const overview = await app.request("/api/usage/overview?days=7");
    expect(overview.status).toBe(200);
    const payload = USAGE_OVERVIEW_PAYLOAD_SCHEMA.parse(await overview.json());
    expect(payload.days).toBe(7);
    expect(payload.cells.length).toBeGreaterThan(0);
    expect((await app.request("/api/usage/unanswered")).status).toBe(200);
  });

  test("反馈审核端点：仅 admin 可列出和处置，处置动作落 feedback 使用日志", async () => {
    const path = freshPath();
    const feedbackRepository = createFeedbackStore(createTestAppDatabase(path));
    const created = await feedbackRepository.create(
      { ask: "能否查看工时", detail: "当前目录缺少工时指标" },
      "alice@x",
    );
    const logged: { tool: string; title?: string }[] = [];
    const feedback = createFeedbackService({
      repository: feedbackRepository,
      usage: {
        log: async (record) => {
          logged.push({ tool: record.tool, title: record.title });
        },
      },
    });
    const routes = (role: string) =>
      dashboardApp({ email: `${role}@x`, name: role, role }, { feedback });
    expect((await routes("user").request("/api/feedback")).status).toBe(403);
    const admin = routes("admin");
    const listed = await admin.request("/api/feedback");
    expect(listed.status).toBe(200);
    expect((await listed.json()) as { total: number }).toMatchObject({
      total: 1,
    });
    const resolved = await admin.request(`/api/feedback/${created.topic_key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "accepted", note: "纳入下一版指标目录" }),
    });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({
      status: "accepted",
      resolved_by: "admin@x",
    });
    expect(logged).toEqual([{ tool: "feedback", title: "接受反馈：能否查看工时" }]);
  });

  test("业务术语端点：公共阅读、管理员即时写入删除与审计均 fail-closed", async () => {
    const id = "b1161af9-a5c1-4d28-b958-9185c04f7a51";
    const logged: { tool: string; title?: string }[] = [];
    const writes: unknown[] = [];
    let listError: Error | null = null;
    const publicRow = {
      id,
      canonical_term: "Band C+",
      definition: "职级处于 Band C及以上的示例人群。",
      aliases: ["Band C及以上"],
      related_members: [],
    };
    const catalog = {
      publicDocument: async () => ({
        access_scope: { id: "organization", title: "组织" },
        observation_scopes: ["统计范围"],
        data_as_of: "2026-07",
        time_context: [],
        metric_domains: [],
        measures: [],
        dimensions: [],
      }),
      dimensionValues: async () => {
        throw new Error("术语维护不应翻值");
      },
    };
    const routes = (role: string) =>
      dashboardApp(
        { email: `${role}@x`, name: role, role },
        {
          catalog,
          businessTerms: {
            listPublic: async (principal) => {
              expect(principal.email).toBe(`${role}@x`);
              return [publicRow];
            },
            listAdmin: async () => {
              if (listError) throw listError;
              return [publicRow];
            },
            create: async (principal, input) => {
              if (input.canonical_term === "重复") throw new InvalidRequestError("术语叫法已存在");
              writes.push({ action: "create", input });
              logged.push({ tool: "business_term_admin", title: "新建业务术语：「Band C+」" });
              expect(principal.email).toBe("admin@x");
              return publicRow;
            },
            update: async (principal, termId, input) => {
              writes.push({ action: "update", termId, input });
              logged.push({ tool: "business_term_admin", title: "更新业务术语：「Band C+」" });
              expect(principal.email).toBe("admin@x");
              return { ...publicRow, ...input };
            },
            remove: async (principal, termId) => {
              writes.push({ action: "delete", termId });
              logged.push({ tool: "business_term_admin", title: "删除业务术语：「Band C+」" });
              expect(principal.email).toBe("admin@x");
              return publicRow;
            },
            restore: async (principal, termId) => {
              writes.push({ action: "restore", termId });
              logged.push({ tool: "business_term_admin", title: "恢复业务术语：「Band C+」" });
              expect(principal.email).toBe("admin@x");
              return publicRow;
            },
          },
        },
      );
    const content = {
      canonical_term: "Band C+",
      definition: "职级处于 Band C及以上的示例人群。",
      aliases: ["Band C及以上"],
      related_member_ids: [],
    };
    const json = (method: string, value: unknown) => ({
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });

    const user = routes("user");
    expect((await user.request("/api/catalog/terms")).status).toBe(200);
    expect(await (await user.request("/api/catalog/terms")).json()).toEqual({ rows: [publicRow] });
    expect((await user.request("/api/admin/business_terms")).status).toBe(403);
    expect((await user.request("/api/admin/business_terms", json("POST", content))).status).toBe(
      403,
    );

    const admin = routes("admin");
    expect((await admin.request("/api/admin/business_terms")).status).toBe(200);
    expect(
      (
        await admin.request(
          "/api/admin/business_terms",
          json("POST", { canonical_term: "Band C+" }),
        )
      ).status,
    ).toBe(400);
    expect((await admin.request("/api/admin/business_terms", json("POST", content))).status).toBe(
      200,
    );
    expect(
      (await admin.request(`/api/admin/business_terms/${id}`, json("PUT", content))).status,
    ).toBe(200);
    expect(
      (await admin.request(`/api/admin/business_terms/${id}`, { method: "DELETE" })).status,
    ).toBe(200);
    expect(
      (await admin.request(`/api/admin/business_terms/${id}/restore`, { method: "POST" })).status,
    ).toBe(200);
    expect(
      (await user.request(`/api/admin/business_terms/${id}/restore`, { method: "POST" })).status,
    ).toBe(403);
    expect(writes.map((write) => (write as { action: string }).action)).toEqual([
      "create",
      "update",
      "delete",
      "restore",
    ]);
    expect(logged.map((record) => record.tool)).toEqual([
      "business_term_admin",
      "business_term_admin",
      "business_term_admin",
      "business_term_admin",
    ]);

    const duplicate = await admin.request(
      "/api/admin/business_terms",
      json("POST", { ...content, canonical_term: "重复" }),
    );
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toEqual({
      error: { code: "invalid_request", message: "术语叫法已存在" },
    });

    listError = new Error("SQLITE_CANTOPEN");
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    try {
      const failed = await admin.request("/api/admin/business_terms");
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({
        error: { code: "internal", message: "服务暂时无法完成请求，请稍后重试" },
      });
      expect(errorLog).toHaveBeenCalledWith("[pa] dashboard 请求失败:", listError);
    } finally {
      errorLog.mockRestore();
    }
  });

  test("role 缺省时按 user 处理", async () => {
    const app = buildApp({ email: "old@x.com", name: "old", role: null });
    expect((await app.request("/api/usage/overview")).status).toBe(403);
    expect((await app.request("/api/me")).status).toBe(200);
  });
});
