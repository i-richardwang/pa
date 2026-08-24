import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { oAuthDiscoveryMetadata, oAuthProtectedResourceMetadata } from "better-auth/plugins";
import { principalFromAttributes, type Principal } from "./contracts/principal.js";
import { buildAuth, initializeAuthSchema, type Auth } from "./auth.js";
import { createApplication } from "./composition/application.js";
import { config } from "./config.js";
import { createCubeGateway } from "./adapters/cube_gateway.js";
import { createBetterAuthUserAccountAdministration } from "./adapters/better_auth_user_account_administration.js";
import { resolveBetterAuthPrincipal } from "./adapters/better_auth_principal.js";
import { SERVICE_CUBE_CONTEXT } from "./engine/cube_security.js";
import { withFormalMetricModel } from "./engine/formal_metric_gateway.js";
import { dashboardRoutes } from "./dashboard/index.js";
import {
  ExportIncompleteError,
  ExportTicketUnavailableError,
} from "./application/export_service.js";
import { isAllowedOrigin } from "./engine/origins.js";
import { buildServer, type McpServerDependencies } from "./server.js";
import { openAppDatabase } from "./storage/app_database.js";
import { openSqlite, type SqliteDatabase } from "./sqlite.js";
import { configuredSemanticPackageDir, loadSemanticPackage } from "./engine/semantic_package.js";
import {
  loadCanonicalSemanticModel,
  withCanonicalSemanticModel,
} from "./engine/canonical_semantic_model.js";
import { createUserAdministrationService } from "./application/user_administration_service.js";

// 鉴权 fail-closed：基座未配置即拒绝启动；PA_ALLOW_OPEN=1 是部署者对当前监听范围的显式放行。
if (!config.authSecret && !config.allowOpen) {
  throw new Error(
    "未配置鉴权：需设 PA_AUTH_SECRET（openssl rand -hex 32）启用鉴权基座；" +
      "若明确接受当前监听范围内无鉴权，可设 PA_ALLOW_OPEN=1 显式放行",
  );
}

type AppEnv = { Variables: { principal: Principal } };
const app = new Hono<AppEnv>();

const appDb = await openAppDatabase(config.appDb);
const semanticPackage = await loadSemanticPackage(configuredSemanticPackageDir());
const visibilityCube = withFormalMetricModel(
  createCubeGateway({
    cubeUrl: config.cubeUrl,
    apiSecret: config.apiSecret,
    accessScopeId: semanticPackage.access_scope.id,
    serviceContext: SERVICE_CUBE_CONTEXT,
    timeSources: semanticPackage.time_sources,
    requestTimeoutMs: config.cubeRequestTimeoutMs,
  }),
  semanticPackage.formal_metrics,
);
const canonicalModel = await loadCanonicalSemanticModel({
  semantic_package: semanticPackage,
  cube: visibilityCube,
  service_context: SERVICE_CUBE_CONTEXT,
});
const cube = withCanonicalSemanticModel(visibilityCube, canonicalModel);
const application = createApplication({
  db: appDb,
  cube,
  visibilityCube,
  canonical: canonicalModel,
  baseUrl: config.baseUrl,
});
const serverDependencies: McpServerDependencies = {
  analysis: application.analysis,
  presentation: application.presentation,
  catalog: application.catalog,
  records: application.recordProjection,
  reports: application.report,
  exports: application.export,
  feedback: application.feedback,
  usage: application.usage,
  baseUrl: config.baseUrl,
};
await application.maintenance.removeExpiredAnalyses();

const LOCAL_PRINCIPAL: Principal = {
  email: "local",
  roles: ["admin"],
  accessScope: { kind: "all" },
};

app.get("/healthz", (c) => c.json({ ok: true }));

const configuredOrigins = [new URL(config.baseUrl).origin, ...config.allowedOrigins];
const originGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header("Origin");
  // 原生 MCP/CLI 请求通常不带 Origin；带 Origin 的浏览器请求必须在服务端真拒绝，不能只靠 CORS。
  if (origin && !isAllowedOrigin(origin, configuredOrigins)) {
    return c.json({ error: "不允许的请求来源" }, 403);
  }
  return next();
};

// 浏览器内宿主（调试宿主、inspector）跨源访问需要 CORS；Origin 守门与 CORS 共用同一白名单。
const localCors = cors({
  origin: (origin) => (isAllowedOrigin(origin, configuredOrigins) ? origin : undefined),
  allowHeaders: ["Content-Type", "Authorization", "Mcp-Protocol-Version", "Mcp-Session-Id"],
  exposeHeaders: ["Mcp-Session-Id", "WWW-Authenticate"],
});
app.use("/mcp", originGuard);
app.use("/.well-known/*", originGuard);
app.use("/api/auth/*", originGuard);
app.use("/mcp", localCors);
app.use("/.well-known/*", localCors);
app.use("/api/auth/*", localCors);

let auth: Auth | null = null;
let authDb: SqliteDatabase | null = null;
if (config.authSecret) {
  const authCfg = {
    baseUrl: config.baseUrl,
    secret: config.authSecret,
    dbPath: config.authDb,
    allowedOrigins: configuredOrigins,
  };
  authDb = await openSqlite(config.authDb);
  await initializeAuthSchema(authCfg, authDb);
  auth = buildAuth(authCfg, authDb);
  const enabledAuth = auth;

  app.on(["GET", "POST"], "/api/auth/*", (c) => enabledAuth.handler(c.req.raw));
  // 根路径发现端点：部分客户端不解析 WWW-Authenticate，直接探测 /.well-known（MCP 规范要求）
  app.get("/.well-known/oauth-authorization-server", (c) =>
    oAuthDiscoveryMetadata(enabledAuth)(c.req.raw),
  );
  app.get("/.well-known/oauth-protected-resource", (c) =>
    oAuthProtectedResourceMetadata(enabledAuth)(c.req.raw),
  );

  const pageLoader = (distFile: string) => {
    let cached: string | undefined;
    const read = () =>
      readFile(new URL(`../console/dist/${distFile}`, import.meta.url), "utf8").catch(() => {
        throw new Error(`页面 ${distFile} 未构建：先运行 bun run build`);
      });
    return async () => {
      if (process.env.NODE_ENV !== "production") return read();
      cached ??= await read();
      return cached;
    };
  };

  const loginHtml = pageLoader("index.html");
  app.get("/login", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.html(await loginHtml());
  });
  // 父 app 的 strict 路由不覆盖子应用，显式归一化尾斜杠。
  app.get("/dashboard/", (c) => c.redirect("/dashboard"));
  app.route(
    "/dashboard",
    dashboardRoutes({
      auth: enabledAuth,
      accessScopeDefinition: canonicalModel.access_scope,
      usage: application.usage,
      html: pageLoader("dashboard.html"),
      userAdministration: (headers) =>
        createUserAdministrationService({
          accounts: createBetterAuthUserAccountAdministration(
            enabledAuth,
            canonicalModel.access_scope,
            headers,
          ),
        }),
      analyses: application.analysis,
      reportService: application.report,
      presentation: application.presentation,
      boardService: application.board,
      feedback: application.feedback,
      catalog: application.catalog,
      businessTerms: application.businessTerms,
      records: application.recordProjection,
      capabilityMap: application.capabilityMap,
    }),
  );
}

// 授权主体解析：token（OAuth 或 API key）只带 userId，回查 email、数据角色和授权范围。
// API key 与 OAuth 共用此解析并生成同一 Cube securityContext。
// 不缓存：角色与数据范围可被管理员随时调整，鉴权正确性优先于按请求省一次查库（与 key 校验同理）。
async function resolvePrincipal(a: Auth, userId: string): Promise<Principal> {
  const ctx = await a.$context;
  return resolveBetterAuthPrincipal(ctx.internalAdapter, userId, semanticPackage.access_scope);
}

// /mcp 鉴权：Bearer 先按 API key 校验（apiKey 插件，key 绑用户），再落 OAuth session；
// 基座未启用且 PA_ALLOW_OPEN=1 = 对当前可达范围开放。两条鉴权通道 caller 均为属主 email。
// key 每请求实时校验不缓存（吊销即时生效，正确性优先于按请求省一次查库）。
app.use("/mcp", async (c, next) => {
  if (!auth) {
    c.set("principal", LOCAL_PRINCIPAL);
    return next();
  }
  const enabledAuth = auth;
  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  // 只对形如 API key 的 bearer 走 apiKey 校验（前缀 = apiKey 插件 defaultPrefix）：
  // OAuth 客户端的 access token 也走 Bearer，不加此闸会对每个 OAuth 请求空跑一次
  // verifyApiKey 并被其抛错刷屏日志；OAuth token 无该前缀，直接落到下面的 session 校验。
  if (bearer?.startsWith("pa_")) {
    const verified = await enabledAuth.api
      .verifyApiKey({ body: { key: bearer } })
      .catch(() => null);
    if (verified?.valid && verified.key) {
      const principal = await resolvePrincipal(enabledAuth, verified.key.referenceId);
      console.log(`[pa] ${principal.email} ${c.req.method} /mcp (api key)`);
      c.set("principal", principal);
      return next();
    }
  }
  const session = await enabledAuth.api.getMcpSession({ headers: c.req.raw.headers });
  if (session) {
    const principal = await resolvePrincipal(enabledAuth, session.userId);
    console.log(`[pa] ${principal.email} ${c.req.method} /mcp (oauth)`);
    c.set("principal", principal);
    return next();
  }
  // 指回受保护资源元数据，兼容不解析 WWW-Authenticate 细节的连接器。
  return c.json(
    { jsonrpc: "2.0", error: { code: -32001, message: "未授权：需要有效凭证" }, id: null },
    401,
    {
      "WWW-Authenticate": `Bearer resource_metadata="${config.baseUrl}/.well-known/oauth-protected-resource"`,
    },
  );
});

// Streamable HTTP，stateless：每请求新建 server+transport，无会话状态
app.all("/mcp", async (c) => {
  const server = buildServer({ dependencies: serverDependencies, principal: c.get("principal") });
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(c);
});

// 导出下载重新认证票据所有者，并按当前权限惰性生成 CSV；明细数据不落盘。
const exportDownload = async (c: Context<AppEnv>) => {
  const ticket = c.req.param("ticket");
  if (!ticket) return c.text("下载链接无效或已过期，请让助手重新生成。", 403);
  try {
    const session = auth ? await auth.api.getSession({ headers: c.req.raw.headers }) : null;
    const principal = auth
      ? session
        ? principalFromAttributes(session.user, semanticPackage.access_scope)
        : null
      : LOCAL_PRINCIPAL;
    if (!principal) return c.text("请先登录后再下载。", 401);
    const { csv, asOf } = await application.export.readResource(principal, ticket);
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pa_export_${asOf}.csv"`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
  } catch (e) {
    if (e instanceof ExportTicketUnavailableError) {
      return c.text("下载链接无效或已过期，请让助手重新生成。", 403);
    }
    if (e instanceof ExportIncompleteError) {
      return c.text(`${e.message}，未生成 CSV——请让助手加过滤条件缩小范围后分批导出。`, 413);
    }
    console.error("[pa] export failed:", e);
    return c.text("导出执行失败（查询已失效或引擎暂不可用），请让助手重新生成链接。", 500);
  }
};
app.get("/export/:ticket", exportDownload);

const httpServer = serve(
  { fetch: app.fetch, port: config.port, hostname: config.bindHost },
  (info) => {
    console.log(
      `pa-server listening on ${config.bindHost}:${info.port} ` +
        `(endpoint /mcp, ${auth ? "oauth enabled" : "OPEN: no authentication"})`,
    );
  },
);

let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  httpServer.close(() => {
    authDb?.close();
    appDb.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
