/**
 * 模拟 MCP 客户端走完整个 OAuth 流程和报告生命周期：动态注册客户端 → 密码登录 → 授权码（PKCE S256）
 * → 换取并刷新 token → 用 token 调 MCP 查询 → 重新运行生成新 View → App 展示和加载工具 → 保存为报告 →
 * 查找、改名、归档报告 → 导出结果 → 控制台重放并与 MCP 结果比对 → 未授权请求返回 401。
 * 修改 OAuth 相关代码后必须运行。
 * 前提：服务已启用 OAuth（设置了 PA_AUTH_SECRET），测试用户已创建。
 * 运行：PA_OAUTH_EMAIL=... PA_OAUTH_PASSWORD=... bun run smoke:oauth [-- http://127.0.0.1:8788]
 * 检查受限权限：先给账号设置单个授权值，再加 PA_EXPECT_ACCESS_SCOPE_VALUE=<授权值>，脚本会检查派生分析只返回该范围的数据。
 */
import { createHash, randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
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
  if (!text) throw new Error("工具没有返回文本内容");
  return text;
}

const resource = `${base}/mcp`;
const unauthenticated = await fetch(resource, { method: "POST" });
const authenticateHeader = unauthenticated.headers.get("WWW-Authenticate") ?? "";
const metadataUrl = /resource_metadata="([^"]+)"/i.exec(authenticateHeader)?.[1];
if (
  unauthenticated.status !== 401 ||
  metadataUrl !== `${base}/.well-known/oauth-protected-resource/mcp`
) {
  throw new Error("401 响应未指向 MCP 资源元数据");
}
const metadata = (await (await fetch(metadataUrl)).json()) as {
  resource: string;
  authorization_servers: string[];
};
if (metadata.resource !== resource) throw new Error("受保护资源标识错误");
const issuer = new URL(metadata.authorization_servers[0]);
const discovery = new URL(`/.well-known/oauth-authorization-server${issuer.pathname}`, issuer);
const meta = (await (await fetch(discovery)).json()) as {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
};
if (!meta.registration_endpoint) throw new Error("OAuth 元数据缺少 registration_endpoint");
console.log("发现:", meta.authorization_endpoint);

// 公共客户端：使用 PKCE，不需要 client secret
const redirectUri = "http://127.0.0.1:9876/callback";
const reg = (await (
  await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "pa-oauth-smoke",
      scope: "mcp offline_access",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  })
).json()) as { client_id: string };
if (!reg.client_id) throw new Error(`注册失败: ${JSON.stringify(reg)}`);
console.log("注册 client_id:", reg.client_id);

// 与浏览器登录页使用同一个接口
const signIn = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  // Better Auth 的 CSRF 校验需要 Origin 头（浏览器会自动带上，这里手动设置）
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

// 首次授权须明确同意，拒绝时只返回拒绝状态。
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const authorizeURL = new URL(meta.authorization_endpoint);
authorizeURL.searchParams.set("response_type", "code");
authorizeURL.searchParams.set("client_id", reg.client_id);
authorizeURL.searchParams.set("redirect_uri", redirectUri);
authorizeURL.searchParams.set("code_challenge", challenge);
authorizeURL.searchParams.set("code_challenge_method", "S256");
authorizeURL.searchParams.set("resource", resource);
authorizeURL.searchParams.set("scope", "mcp offline_access");
const state = b64url(randomBytes(18));
authorizeURL.searchParams.set("state", state);
async function decide(accept: boolean) {
  const authorize = await fetch(authorizeURL, { headers: { cookie }, redirect: "manual" });
  const location = authorize.headers.get("location");
  if (!location) throw new Error(`授权端点响应异常：${authorize.status}`);
  const consent = new URL(location, base);
  if (consent.origin !== base || consent.pathname !== "/consent")
    throw new Error("授权端点没有转到同意页");
  const response = await fetch(`${base}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: { cookie, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ accept, oauth_query: consent.searchParams.toString() }),
  });
  if (!response.ok) throw new Error(`授权同意失败：${response.status}`);
  const { url } = (await response.json()) as { url: string };
  const callback = new URL(url);
  if (
    callback.origin + callback.pathname !== redirectUri ||
    callback.searchParams.get("state") !== state
  )
    throw new Error("授权回调或状态不匹配");
  return callback.searchParams;
}
const denied = await decide(false);
if (denied.get("error") !== "access_denied" || denied.has("code"))
  throw new Error("拒绝授权时响应异常");
const code = (await decide(true)).get("code");
if (!code) throw new Error("同意后未取得授权码");
console.log("已取得授权码");

async function exchangeToken(grant: Record<string, string>) {
  const response = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...grant, client_id: reg.client_id, resource }),
  });
  if (!response.ok)
    throw new Error(`令牌端点拒绝 ${grant.grant_type} 请求（HTTP ${response.status}）`);
  return (await response.json()) as { access_token: string; refresh_token: string };
}
const issued = await exchangeToken({
  grant_type: "authorization_code",
  code,
  redirect_uri: redirectUri,
  code_verifier: verifier,
});
if (!issued.access_token || !issued.refresh_token) throw new Error("授权码未换到访问和刷新令牌");
const token = await exchangeToken({
  grant_type: "refresh_token",
  refresh_token: issued.refresh_token,
});
if (!token.access_token || !token.refresh_token || token.refresh_token === issued.refresh_token)
  throw new Error("刷新令牌未轮换");
console.log("已换取访问令牌并轮换刷新令牌");

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
  throw new Error("show_analysis 的 UI 元数据不符合预期");
}
const loadMeta = listedByName.load_analysis_result?._meta as
  | { ui?: { resourceUri?: string; visibility?: string[] } }
  | undefined;
if (
  loadMeta?.ui?.resourceUri !== undefined ||
  JSON.stringify(loadMeta?.ui?.visibility) !== JSON.stringify(["model"])
) {
  throw new Error("load_analysis_result 应只对模型可见");
}
const appLoadMeta = listedByName.load_analysis_card?._meta as
  | { ui?: { resourceUri?: string; visibility?: string[] } }
  | undefined;
if (
  appLoadMeta?.ui?.resourceUri !== undefined ||
  JSON.stringify(appLoadMeta?.ui?.visibility) !== JSON.stringify(["app"])
) {
  throw new Error("load_analysis_card 应只对 App 可见");
}
const showRecordsMeta = listedByName.show_records?._meta as
  | { ui?: { resourceUri?: string; visibility?: string[] } }
  | undefined;
if (
  showRecordsMeta?.ui?.resourceUri !== RECORDS_UI_RESOURCE_URI ||
  JSON.stringify(showRecordsMeta.ui.visibility) !== JSON.stringify(["model"])
) {
  throw new Error("show_records 的 UI 元数据不符合预期");
}

// run_analysis 分别接收 AnalysisDefinition 和 ViewIntent；成员都用 catalog 返回的语义 id。
const currentMonthTime = (anchor?: string) => ({
  window: { kind: "current_month", ...(anchor ? { month: anchor } : {}) },
});

async function callTool(request: Parameters<typeof client.callTool>[0]) {
  const result = await client.callTool(request);
  if (result.isError) throw new Error(`${request.name}: ${toolText(result)}`);
  return result;
}
// catalog 的 terms 每项是一个完整的业务概念；返回的成员只有语义 id、标题和类型，维度取值要另用 values_of 查询。
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
    `catalog 按 terms 检索的结果不符合预期: ${JSON.stringify({
      matched_terms: catalogPayload.matched_terms,
      unmatched_terms: catalogPayload.unmatched_terms,
      metric_domains: catalogPayload.metric_domains.map((row) => row.title),
    })}`,
  );
}
// 按业务标题和类型，从 catalog 结果里找出唯一的语义 id。
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
      `catalog 结果里找不到唯一匹配的成员：${kind} ${title}; ${JSON.stringify(
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
// values_of 只接受维度的语义 id
const valuesResult = JSON.parse(
  toolText(await callTool({ name: "values_of", arguments: { dimension: ORG_NAME } })),
) as { values?: unknown };
if (!Array.isArray(valuesResult.values)) throw new Error("values_of 没有返回取值数组");
console.log("catalog、values_of 和语义 id 查找正常");
// 这里只验证 OAuth token 能查询数据，所以查全量在职人数，不带筛选值；
// title 用于稍后在查询记录里找到这次查询。
const smokeTitle = `oauth-smoke 在职人数 ${Date.now()}`;
const q = await callTool({
  name: "run_analysis",
  arguments: {
    analysis: {
      title: smokeTitle,
      query: { measures: [ACTIVE_EMPLOYEE], time: currentMonthTime() },
    },
    view: { type: "table" },
  },
});
const queryPayload = RUN_OUTPUT_SCHEMA.parse(
  (q as { structuredContent?: unknown }).structuredContent,
);
const queryView = queryPayload.view;
const row = queryView?.rows?.[0];
console.log("OAuth 查询结果:", JSON.stringify(row));
if (!row?.length) throw new Error("OAuth 查询没有返回数据");
if (
  queryView?.time?.grain !== "total" ||
  queryView.time.buckets.length !== 1 ||
  queryView.time.buckets[0].from !== queryPayload.data_as_of ||
  queryView.time.buckets[0].to !== queryPayload.data_as_of
) {
  throw new Error(
    `查询结果的时间信息不符合预期（应为数据截止月）: ${JSON.stringify(queryView?.time)}`,
  );
}
const activeEmployeeNote = queryView.display_notes?.find((note) => note.member === ACTIVE_EMPLOYEE);
if (!activeEmployeeNote || activeEmployeeNote.text.includes("累计")) {
  throw new Error(`在职人数的口径说明不应出现「累计」: ${JSON.stringify(activeEmployeeNote)}`);
}
if (typeof queryPayload.analysis_id !== "string") {
  throw new Error("run_analysis 未返回 analysis_id");
}

// 重新运行会创建新的 View，原 Analysis 不变
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
  throw new Error("rerun_analysis 应沿用原 Analysis 并创建新 View");
}
const shownResult = await callTool({
  name: "show_analysis",
  arguments: { view_id: rerunPayload.view_id },
});
if (
  (shownResult as { structuredContent?: { view_id?: unknown } }).structuredContent?.view_id !==
  rerunPayload.view_id
) {
  throw new Error("show_analysis 返回的 view_id 与请求不一致");
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
  throw new Error("load_analysis_result 返回的定义、呈现方式或结果与新 View 不一致");
}
console.log("rerun、show、load 流程正常");

// 人员名单从聚合分析直接取得：模型只能看到摘要，逐人记录只放在 App 专用的 _meta 里。
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
  throw new Error("show_records 给模型的摘要里出现了人员记录");
}
RECORD_PROJECTION_PAYLOAD_SCHEMA.parse(
  (recordsResult as { _meta?: Record<string, unknown> })._meta?.[RECORD_PROJECTION_META_KEY],
);
console.log("show_records 正常，人员记录只在 App 中可见");

// 跨年按月查询时，每行都要有 year 和 month 两列。
const asOfYear = Number(String(queryPayload.data_as_of).slice(0, 4));
const periodQuery = await callTool({
  name: "run_analysis",
  arguments: {
    analysis: {
      query: {
        measures: [HIRE_COUNT],
        time: {
          window: {
            kind: "range",
            from: `${asOfYear - 2}-01`,
            to: `${asOfYear - 1}-06`,
            grain: "month",
          },
        },
      },
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
  throw new Error("跨年按月查询的结果缺少 year 或 month 列");
}
if (
  periodView.time?.grain !== "month" ||
  periodView.time.buckets.length !== 18 ||
  periodView.time.buckets[0]?.from !== `${asOfYear - 2}-01` ||
  periodView.time.buckets.at(-1)?.to !== `${asOfYear - 1}-06`
) {
  throw new Error(`按期间查询的时间信息不符合预期: ${JSON.stringify(periodView.time)}`);
}
const smokeTitle2 = `oauth-smoke 分组织在职 ${Date.now()}`;
await callTool({
  name: "run_analysis",
  arguments: {
    analysis: {
      title: smokeTitle2,
      query: { measures: [ACTIVE_EMPLOYEE], dimensions: [ORG_NAME], time: currentMonthTime() },
    },
    view: { type: "table" },
  },
});

// 派生分析：检查两个输入、join 和逐行公式；受限账号还要检查结果里只有授权范围内的组织。
const expectedScopedOrg = process.env.PA_EXPECT_ACCESS_SCOPE_VALUE?.trim();
const scopedTitle = `oauth-smoke ${expectedScopedOrg ? "受限" : ""}派生 ${Date.now()}`;
const scopedQuery = await callTool({
  name: "run_analysis",
  arguments: {
    analysis: {
      title: scopedTitle,
      query: {
        view_title: `${asOfYear}年`,
        measures: [ACTIVE_EMPLOYEE],
        dimensions: [ORG_NAME],
        time: currentMonthTime(queryPayload.data_as_of),
      },
      derived: {
        view_title: "同比变化",
        joined: {
          query: {
            view_title: `${asOfYear - 1}年`,
            measures: [ACTIVE_EMPLOYEE],
            dimensions: [ORG_NAME],
            time: currentMonthTime(`${asOfYear - 1}-${String(queryPayload.data_as_of).slice(5)}`),
          },
          on: [ORG_NAME],
          how: "left",
        },
        columns: [
          { member: ORG_NAME, source: "query", as: "organization" },
          { member: ACTIVE_EMPLOYEE, source: "query", as: "current_headcount" },
          { member: ACTIVE_EMPLOYEE, source: "joined", as: "previous_headcount" },
          {
            expr: {
              op: "-",
              left: { member: ACTIVE_EMPLOYEE, source: "query" },
              right: { member: ACTIVE_EMPLOYEE, source: "joined" },
            },
            as: "headcount_change",
          },
        ],
      },
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
  throw new Error(`派生分析的结果或 provenance 不符合预期: ${JSON.stringify(scopedPayload.view)}`);
}
console.log(`派生分析: ${scopedView.rows.length} 行，join 和逐行公式正常`);
if (expectedScopedOrg) {
  const orgColumn = scopedView.columns.indexOf("organization");
  if (
    orgColumn < 0 ||
    scopedView.rows.length !== 1 ||
    scopedView.rows[0]?.[orgColumn] !== expectedScopedOrg
  ) {
    throw new Error(`受限账号的派生分析出现了授权范围外的组织: ${JSON.stringify(scopedView)}`);
  }
  const current = Number(scopedView.rows[0]?.[scopedView.columns.indexOf("current_headcount")]);
  const previous = Number(scopedView.rows[0]?.[scopedView.columns.indexOf("previous_headcount")]);
  const delta = Number(scopedView.rows[0]?.[scopedView.columns.indexOf("headcount_change")]);
  if (!Number.isFinite(delta) || delta !== current - previous) {
    throw new Error(`受限账号的派生分析差值错误: ${delta} != ${current} - ${previous}`);
  }
  console.log(`受限账号派生分析: ${expectedScopedOrg} 1 行，差值 ${delta}`);
}
// MCP 报告流程：保存、查找、改名、导出、归档
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
  throw new Error(`find_report 没有返回报告链接: ${JSON.stringify(found)}`);
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
if (updated.revision !== saved.revision + 1)
  throw new Error("update_report 之后 revision 没有加 1");
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

// 控制台通过查询记录找到 View 并重放；查询记录本身只是日志。
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
if (!replayRes.ok) throw new Error(`重放失败: ${replayRes.status} ${await replayRes.text()}`);
const replay = (await replayRes.json()) as {
  payload: { view: { rows: (string | number | null)[][] } };
};
if (JSON.stringify(replay.payload.view.rows[0]) !== JSON.stringify(row)) {
  throw new Error("控制台重放结果与 MCP 查询结果不一致");
}
const anonReplay = await fetch(`${base}/dashboard/api/analysis_views/${mineRow.view_id}/replay`);
if (anonReplay.status !== 401)
  throw new Error(`未登录访问重放接口应返回 401: ${anonReplay.status}`);
console.log("分析、报告、导出和控制台重放正常");

console.log("OAUTH SMOKE OK");
