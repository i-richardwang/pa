/**
 * OAuth 全流程冒烟：动态客户端注册 → 密码登录 → 授权码（PKCE S256）→ 换 token →
 * 持 token 走 MCP 查数 → 派生新 View → App 展示/加载工具 → View 保存为报告 → 查找、运行、更新、归档报告
 * → 导出分析结果 → 控制台按 View 重放并与 MCP 通道对数 → 未授权端点返回 401。
 * 模拟 MCP 客户端连接器的完整握手路径与报告生命周期，
 * OAuth 侧改动后必跑。
 * 前置：服务已启用 OAuth（PA_AUTH_SECRET）且测试用户已开通。
 * 运行：PA_OAUTH_EMAIL=... PA_OAUTH_PASSWORD=... bun run smoke:oauth [-- http://127.0.0.1:8788]
 * 受限权限回归：账号先配置单一 access_scope，再加 PA_EXPECT_ACCESS_SCOPE_VALUE=<授权值>；脚本会验证派生查询及重放。
 */
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CATALOG_OUTPUT_SCHEMA,
  LOAD_ANALYSIS_OUTPUT_SCHEMA,
  RECORDS_OUTPUT_SCHEMA,
  RECORDS_UI_RESOURCE_URI,
  RUN_OUTPUT_SCHEMA,
  UI_RESOURCE_URI,
} from "../src/mcp/contracts.js";
import {
  RECORD_PROJECTION_PAYLOAD_SCHEMA,
  RECORD_PROJECTION_META_KEY,
} from "../src/contracts/record_projection_contract.js";

const base = (process.argv[2] ?? "http://127.0.0.1:8788").replace(/\/$/, "");
const email = process.env.PA_OAUTH_EMAIL;
const password = process.env.PA_OAUTH_PASSWORD;
if (!email || !password) throw new Error("请设置 PA_OAUTH_EMAIL / PA_OAUTH_PASSWORD");

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function toolText(result: unknown): string {
  const text = (result as { content?: { type: string; text?: string }[] }).content?.find(
    (item) => item.type === "text",
  )?.text;
  if (!text) throw new Error("工具未返回文本应答");
  return text;
}

// 根路径 well-known 是 MCP 客户端的探测入口
const meta = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
};
if (!meta.registration_endpoint) throw new Error("发现元数据缺 registration_endpoint");
console.log("发现:", meta.authorization_endpoint);

// 公共客户端，PKCE 免密钥
const redirectUri = "http://127.0.0.1:9876/callback";
const reg = (await (
  await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "pa-oauth-smoke",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    }),
  })
).json()) as { client_id: string };
if (!reg.client_id) throw new Error(`注册失败: ${JSON.stringify(reg)}`);
console.log("注册 client_id:", reg.client_id);

// 与浏览器登录页同一接口
const signIn = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  // Origin 为 Better Auth CSRF 校验所需（浏览器自动携带，脚本模拟之）
  headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify({ email, password }),
});
if (!signIn.ok) throw new Error(`登录失败: ${signIn.status} ${await signIn.text()}`);
const cookie = signIn.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
if (!cookie) throw new Error("登录未返回会话 cookie");
console.log("登录成功:", email);

// PKCE S256；已登录会话直接发码重定向
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const authorizeURL = new URL(meta.authorization_endpoint);
authorizeURL.searchParams.set("response_type", "code");
authorizeURL.searchParams.set("client_id", reg.client_id);
authorizeURL.searchParams.set("redirect_uri", redirectUri);
authorizeURL.searchParams.set("code_challenge", challenge);
authorizeURL.searchParams.set("code_challenge_method", "S256");
authorizeURL.searchParams.set("state", b64url(randomBytes(8)));
const authorize = await fetch(authorizeURL, { headers: { cookie }, redirect: "manual" });
const location = authorize.headers.get("location") ?? "";
const code = new URL(location, base).searchParams.get("code");
if (!code) throw new Error(`授权未发码: ${authorize.status} ${location}`);
console.log("授权码已发");

const token = (await (
  await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: reg.client_id,
      code_verifier: verifier,
    }),
  })
).json()) as { access_token?: string; error?: string };
if (!token.access_token) throw new Error(`换 token 失败: ${JSON.stringify(token)}`);
console.log("access token 已取得");

// 金标准数字与 API key 通道一致
const client = new Client({ name: "pa-oauth-smoke", version: "0.1.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } },
  }),
);

const listedTools = await client.listTools();
const listedByName = Object.fromEntries(listedTools.tools.map((tool) => [tool.name, tool]));
for (const name of ["run_analysis", "rerun_analysis"]) {
  if ((listedByName[name]?._meta as { ui?: unknown } | undefined)?.ui !== undefined) {
    throw new Error(`${name} 不应绑定 MCP App`);
  }
}
const showMeta = listedByName.show_analysis?._meta as
  | { ui?: { resourceUri?: string; visibility?: string[] } }
  | undefined;
if (
  showMeta?.ui?.resourceUri !== UI_RESOURCE_URI ||
  JSON.stringify(showMeta.ui.visibility) !== JSON.stringify(["model"])
) {
  throw new Error("show_analysis UI 契约异常");
}
const loadMeta = listedByName.load_analysis_result?._meta as
  | { ui?: { resourceUri?: string; visibility?: string[] } }
  | undefined;
if (
  loadMeta?.ui?.resourceUri !== undefined ||
  JSON.stringify(loadMeta?.ui?.visibility) !== JSON.stringify(["model"])
) {
  throw new Error("load_analysis_result model-only 契约异常");
}
const appLoadMeta = listedByName.load_analysis_card?._meta as
  | { ui?: { resourceUri?: string; visibility?: string[] } }
  | undefined;
if (
  appLoadMeta?.ui?.resourceUri !== undefined ||
  JSON.stringify(appLoadMeta?.ui?.visibility) !== JSON.stringify(["app"])
) {
  throw new Error("load_analysis_card app-only 契约异常");
}
const showRecordsMeta = listedByName.show_records?._meta as
  | { ui?: { resourceUri?: string; visibility?: string[] } }
  | undefined;
if (
  showRecordsMeta?.ui?.resourceUri !== RECORDS_UI_RESOURCE_URI ||
  JSON.stringify(showRecordsMeta.ui.visibility) !== JSON.stringify(["model"])
) {
  throw new Error("show_records UI 契约异常");
}

// run_analysis 收独立的 AnalysisDefinition 与 ViewIntent；成员一律用 catalog 语义 id。
function analysisInput(raw: Record<string, unknown>) {
  const { title, views: declaredViews, ...flat } = raw;
  const sourceViews = Array.isArray(declaredViews) ? declaredViews : [flat];
  const views = sourceViews.map((candidate, index) => {
    const view = candidate as Record<string, unknown>;
    const id =
      typeof view.id === "string"
        ? view.id
        : "from" in view
          ? `derived_${index + 1}`
          : `query_${index + 1}`;
    return { ...view, id };
  });
  return {
    analysis: { ...(typeof title === "string" ? { title } : {}), views },
    view: { type: "table" },
  };
}

const currentMonthTime = (anchor?: string) => ({
  window: { kind: "current_month", ...(anchor ? { month: anchor } : {}) },
});

async function callTool(request: Parameters<typeof client.callTool>[0]) {
  return client.callTool(
    request.name === "run_analysis"
      ? { ...request, arguments: analysisInput(request.arguments ?? {}) }
      : request,
  );
}
// catalog 协议：terms 每项是完整业务概念；成员只发语义 id/title/kind，真实值由 values_of 独立负责。
const catalogPayload = CATALOG_OUTPUT_SCHEMA.parse(
  JSON.parse(
    toolText(
      await callTool({
        name: "catalog",
        arguments: { terms: ["离职率", "组织", "编制"] },
      }),
    ),
  ),
);
if (
  !catalogPayload.matched_terms?.includes("编制") ||
  !catalogPayload.metric_domains.some((row) => row.title === "编制计划与完成")
) {
  throw new Error(
    `catalog terms 数组检索异常: ${JSON.stringify({
      matched_terms: catalogPayload.matched_terms,
      unmatched_terms: catalogPayload.unmatched_terms,
      metric_domains: catalogPayload.metric_domains.map((row) => row.title),
    })}`,
  );
}
// 语义 id 解析器：只从 catalog 返回的 id/title/kind 解析，按业务标题 + 类型唯一命中；物理名从不出现。
const resolverCatalog = CATALOG_OUTPUT_SCHEMA.parse(
  JSON.parse(
    toolText(
      await callTool({ name: "catalog", arguments: { terms: ["在职人数", "入职人数", "组织"] } }),
    ),
  ),
);
const resolverMembers = [
  ...(resolverCatalog.measures ?? []),
  ...(resolverCatalog.dimensions ?? []),
];
function sid(title: string, kind: "measure" | "dimension"): string {
  const matches = resolverMembers.filter((m) => m.title === title && m.kind === kind);
  if (matches.length !== 1) {
    throw new Error(
      `catalog 未唯一解析语义 id：${kind} ${title}; ${JSON.stringify(
        resolverMembers
          .filter((member) => member.kind === kind)
          .map((member) => ({
            id: member.id,
            title: member.title,
          })),
      )}`,
    );
  }
  return matches[0].id;
}
const ACTIVE_EMPLOYEE = sid("在职人数", "measure");
const HIRE_COUNT = sid("入职人数", "measure");
const ORG_NAME = sid("组织", "dimension");
// values_of 只收语义 dimension id
const valuesResult = JSON.parse(
  toolText(await callTool({ name: "values_of", arguments: { dimension: ORG_NAME } })),
) as { values?: unknown };
if (!Array.isArray(valuesResult.values)) throw new Error("values_of 未返回真实值数组");
console.log("catalog terms / values_of / 语义 id 解析已验证");
// 本条只验证 OAuth 通道能查数，查询不携带业务值：
// 全局在职人数（显式使用 data_as_of 快照）；
// title 是后续从 mine 端点精确定位该查询的稳定标识。
const smokeTitle = `oauth-smoke 在职人数 ${Date.now()}`;
const q = await callTool({
  name: "run_analysis",
  arguments: {
    analysis: {
      title: smokeTitle,
      views: [{ id: "result", measures: [ACTIVE_EMPLOYEE], time: currentMonthTime() }],
    },
    view: { type: "table" },
  },
});
const queryPayload = RUN_OUTPUT_SCHEMA.parse(
  (q as { structuredContent?: unknown }).structuredContent,
);
const queryView = queryPayload.view;
const row = queryView?.rows?.[0];
console.log("OAuth 通道查数:", JSON.stringify(row));
if (!row?.length) throw new Error("OAuth 通道查数无结果");
if (
  queryView?.time?.grain !== "total" ||
  queryView.time.buckets.length !== 1 ||
  queryView.time.buckets[0].from !== queryPayload.data_as_of ||
  queryView.time.buckets[0].to !== queryPayload.data_as_of
) {
  throw new Error(`默认查询未声明业务时间: ${JSON.stringify(queryView?.time)}`);
}
const activeEmployeeNote = queryView.display_notes?.find((note) => note.member === ACTIVE_EMPLOYEE);
if (!activeEmployeeNote || activeEmployeeNote.text.includes("累计")) {
  throw new Error(`快照指标口径被动态改写: ${JSON.stringify(activeEmployeeNote)}`);
}
if (typeof queryPayload.analysis_id !== "string") {
  throw new Error("run_analysis 未返回 analysis_id");
}

// 重跑创建新的不可变 View
const rerunResult = await callTool({
  name: "rerun_analysis",
  arguments: {
    analysis_id: queryPayload.analysis_id,
    view: { type: "table" },
  },
});
const rerunPayload = RUN_OUTPUT_SCHEMA.parse(
  (rerunResult as { structuredContent?: unknown }).structuredContent,
);
if (
  rerunPayload.analysis_id !== queryPayload.analysis_id ||
  rerunPayload.view_id === queryPayload.view_id
) {
  throw new Error("rerun_analysis 未保留 Analysis 并派生新 View");
}
const shownResult = await callTool({
  name: "show_analysis",
  arguments: { view_id: rerunPayload.view_id },
});
if (
  (shownResult as { structuredContent?: { view_id?: unknown } }).structuredContent?.view_id !==
  rerunPayload.view_id
) {
  throw new Error("show_analysis 未回显指定的新 view_id");
}
const loadedResult = await callTool({
  name: "load_analysis_result",
  arguments: { view_id: rerunPayload.view_id },
});
const loadedPayload = LOAD_ANALYSIS_OUTPUT_SCHEMA.parse(
  (loadedResult as { structuredContent?: unknown }).structuredContent,
);
if (
  loadedPayload.view_id !== rerunPayload.view_id ||
  JSON.stringify(loadedPayload.view.rows) !== JSON.stringify(rerunPayload.view.rows) ||
  loadedPayload.view_intent.type !== "table"
) {
  throw new Error("load_analysis_result 未按新 View 返回定义、呈现意图与重放结果");
}
console.log("不可变 rerun / show / model load 链路已验证");

// 人员名单由聚合 Analysis 直接投影：模型只见摘要，逐人记录只在 App 私有 _meta。
const recordsResult = await callTool({
  name: "show_records",
  arguments: { view_id: rerunPayload.view_id },
});
const recordsSummary = RECORDS_OUTPUT_SCHEMA.parse(
  (recordsResult as { structuredContent?: unknown }).structuredContent,
);
if (
  recordsSummary.view_id !== rerunPayload.view_id ||
  JSON.stringify(recordsSummary).includes("employee_name") ||
  JSON.stringify(recordsSummary).includes("rows")
) {
  throw new Error("show_records 模型可见摘要泄漏了人员记录");
}
RECORD_PROJECTION_PAYLOAD_SCHEMA.parse(
  (recordsResult as { _meta?: Record<string, unknown> })._meta?.[RECORD_PROJECTION_META_KEY],
);
console.log("show_records 聚合单元格 → App 私有人员记录链路已验证");

// 产品结果契约：跨年月粒度带完整 year/month 行键，explain 恒为逐窗数组。
const asOfYear = Number(String(queryPayload.data_as_of).slice(0, 4));
const periodQuery = await callTool({
  name: "run_analysis",
  arguments: {
    analysis: {
      views: [
        {
          id: "result",
          measures: [HIRE_COUNT],
          time: {
            window: { kind: "range", from: `${asOfYear - 2}-01`, to: `${asOfYear - 1}-06` },
            display: "month",
          },
        },
      ],
    },
    view: { type: "table" },
  },
});
const periodView = RUN_OUTPUT_SCHEMA.parse(
  (periodQuery as { structuredContent?: unknown }).structuredContent,
).view;
if (
  JSON.stringify(periodView.columns) !== JSON.stringify(["year", "month", HIRE_COUNT]) ||
  periodView.row_count !== 18 ||
  periodView.rows.some((periodRow) => periodRow.length !== 3)
) {
  throw new Error("跨年 period 月粒度结果缺完整 year/month 行键");
}
if (
  periodView.time?.grain !== "month" ||
  periodView.time.buckets.length !== 18 ||
  periodView.time.buckets[0]?.from !== `${asOfYear - 2}-01` ||
  periodView.time.buckets.at(-1)?.to !== `${asOfYear - 1}-06`
) {
  throw new Error(`period 业务时间声明异常: ${JSON.stringify(periodView.time)}`);
}
const smokeTitle2 = `oauth-smoke 分组织在职 ${Date.now()}`;
await callTool({
  name: "run_analysis",
  arguments: {
    analysis: {
      title: smokeTitle2,
      views: [
        {
          id: "result",
          measures: [ACTIVE_EMPLOYEE],
          dimensions: [ORG_NAME],
          time: currentMonthTime(),
        },
      ],
    },
    view: { type: "table" },
  },
});

// 派生链路恒验两路输入、关联与逐行算式；受限账号额外验证三张结果都只出现 scope 内组织。
const expectedScopedOrg = process.env.PA_EXPECT_ACCESS_SCOPE_VALUE?.trim();
const scopedTitle = `oauth-smoke ${expectedScopedOrg ? "受限" : ""}派生 ${Date.now()}`;
const scopedQuery = await callTool({
  name: "run_analysis",
  arguments: {
    analysis: {
      title: scopedTitle,
      views: [
        {
          id: "current",
          view_title: `${asOfYear}年`,
          measures: [ACTIVE_EMPLOYEE],
          dimensions: [ORG_NAME],
          time: currentMonthTime(queryPayload.data_as_of),
        },
        {
          id: "previous",
          view_title: `${asOfYear - 1}年`,
          measures: [ACTIVE_EMPLOYEE],
          dimensions: [ORG_NAME],
          time: currentMonthTime(`${asOfYear - 1}-${String(queryPayload.data_as_of).slice(5)}`),
        },
        {
          id: "delta",
          view_title: "同比变化",
          from: ["current", "previous"],
          join: { on: [ORG_NAME], how: "left" },
          columns: [
            { member: ORG_NAME, source: "current", as: "组织" },
            { member: ACTIVE_EMPLOYEE, source: "current", as: `${asOfYear}年在职人数` },
            { member: ACTIVE_EMPLOYEE, source: "previous", as: `${asOfYear - 1}年在职人数` },
            {
              expr: {
                op: "-",
                left: { member: ACTIVE_EMPLOYEE, source: "current" },
                right: { member: ACTIVE_EMPLOYEE, source: "previous" },
              },
              as: "在职人数同比变化",
            },
          ],
        },
      ],
    },
    view: { type: "table" },
  },
});
const scopedPayload = RUN_OUTPUT_SCHEMA.parse(
  (scopedQuery as { structuredContent?: unknown }).structuredContent,
);
const scopedView = scopedPayload.view;
if (
  !scopedView.provenance?.formula ||
  scopedView.provenance.sources.length !== 2 ||
  !scopedView.provenance.join_keys.some((key) => key.id === ORG_NAME) ||
  !scopedView.rows.length
) {
  throw new Error(`派生查询交付面或 provenance 异常: ${JSON.stringify(scopedPayload.view)}`);
}
console.log(`派生查询: 单一组合结果，${scopedView.rows.length} 行，join 与逐行算式正常`);
if (expectedScopedOrg) {
  const orgColumn = scopedView.columns.indexOf("组织");
  if (
    orgColumn < 0 ||
    scopedView.rows.length !== 1 ||
    scopedView.rows[0]?.[orgColumn] !== expectedScopedOrg
  ) {
    throw new Error(`受限派生链路出现 scope 外数据: ${JSON.stringify(scopedView)}`);
  }
  const current = Number(scopedView.rows[0]?.[scopedView.columns.indexOf(`${asOfYear}年在职人数`)]);
  const previous = Number(
    scopedView.rows[0]?.[scopedView.columns.indexOf(`${asOfYear - 1}年在职人数`)],
  );
  const delta = Number(scopedView.rows[0]?.[scopedView.columns.indexOf("在职人数同比变化")]);
  if (!Number.isFinite(delta) || delta !== current - previous) {
    throw new Error(`受限派生差值错误: ${delta} != ${current} - ${previous}`);
  }
  console.log(`受限派生查询: ${expectedScopedOrg} 单一组合结果为 1 行，差值 ${delta}`);
}
// analysis → report pointer → find/update/export 的 MCP 产品链路
const saved = JSON.parse(
  toolText(
    await callTool({
      name: "save_report",
      arguments: { view_id: queryPayload.view_id, name: `oauth-smoke 报告 ${Date.now()}` },
    }),
  ),
) as { id: string; revision: number };
const found = JSON.parse(
  toolText(await callTool({ name: "find_report", arguments: { query: "oauth-smoke" } })),
);
const foundReport = found.reports?.find((report: { id: string }) => report.id === saved.id) as
  | { id: string; analysis_id: string; view_id: string; url: string }
  | undefined;
if (
  !foundReport ||
  foundReport.view_id !== queryPayload.view_id ||
  !foundReport.url.includes("#/report/")
) {
  throw new Error(`find_report 未返回报告深链: ${JSON.stringify(found)}`);
}
const updated = JSON.parse(
  toolText(
    await callTool({
      name: "update_report",
      arguments: {
        id: saved.id,
        action: { type: "rename", name: `oauth-smoke 已更新 ${Date.now()}` },
        if_revision: saved.revision,
      },
    }),
  ),
);
if (updated.revision !== saved.revision + 1) throw new Error("update_report revision 未递增");
const exported = JSON.parse(
  toolText(
    await callTool({
      name: "export_result",
      arguments: {
        view_id: queryPayload.view_id,
      },
    }),
  ),
);
if (
  exported.analysis_id !== queryPayload.analysis_id ||
  exported.view_id !== queryPayload.view_id ||
  !exported.url
) {
  throw new Error(`export_result 返回异常: ${JSON.stringify(exported)}`);
}
await callTool({
  name: "update_report",
  arguments: {
    id: saved.id,
    action: { type: "archive" },
    if_revision: updated.revision,
  },
});
await client.close();

// 控制台按不可变 View 重放，usage_log 仅承担观察日志职责。
const mine = (await (
  await fetch(`${base}/dashboard/api/usage/mine?days=1`, { headers: { cookie } })
).json()) as { rows: { title: string; analysis_id: string | null; view_id: string | null }[] };
const mineRow = mine.rows.find(
  (entry) => entry.title === smokeTitle && entry.view_id === queryPayload.view_id,
);
if (!mineRow) {
  throw new Error(`查询记录未关联 View: ${JSON.stringify(mineRow)}`);
}
const replayRes = await fetch(`${base}/dashboard/api/analysis_views/${mineRow.view_id}/replay`, {
  headers: { cookie },
});
if (!replayRes.ok)
  throw new Error(`analysis 重放失败: ${replayRes.status} ${await replayRes.text()}`);
const replay = (await replayRes.json()) as {
  payload: { view: { rows: (string | number | null)[][] } };
};
if (JSON.stringify(replay.payload.view.rows[0]) !== JSON.stringify(row)) {
  throw new Error("web analysis 重放与 MCP 通道不同数");
}
const anonReplay = await fetch(`${base}/dashboard/api/analysis_views/${mineRow.view_id}/replay`);
if (anonReplay.status !== 401) throw new Error(`重放端点未登录应 401: ${anonReplay.status}`);
console.log("analysis/report/export 与 web 重放链路正常");

// WWW-Authenticate 须指向受保护资源元数据（MCP 客户端发现链路）
const unauth = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
const wwwAuth = unauth.headers.get("www-authenticate") ?? "";
if (unauth.status !== 401 || !wwwAuth.includes("resource_metadata")) {
  throw new Error(`未授权应答异常: ${unauth.status} ${wwwAuth}`);
}
const prm = (await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json()) as {
  authorization_servers?: string[];
};
if (!prm.authorization_servers?.length) throw new Error("受保护资源元数据缺 authorization_servers");
console.log("401 指引与资源元数据正常");

console.log("OAUTH SMOKE OK");
