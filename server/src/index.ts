import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { oAuthDiscoveryMetadata, oAuthProtectedResourceMetadata } from "better-auth/plugins";
import { principalFromAttributes, type Principal } from "./contracts/principal.js";
import { API_KEY_PREFIX, buildAuth, initializeAuthSchema, type Auth } from "./auth.js";
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

if (!config.authSecret && !config.allowOpen) {
  throw new Error(
    "未配置鉴权：请设置 PA_AUTH_SECRET（可用 openssl rand -hex 32 生成）启用登录鉴权；" +
      "如果确定允许能访问该地址的所有人免登录使用，可设置 PA_ALLOW_OPEN=1",
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
  // 原生 MCP/CLI 请求通常不带 Origin；浏览器请求带 Origin，必须在服务端拒绝未允许的来源，CORS 挡不住请求本身。
  if (origin && !isAllowedOrigin(origin, configuredOrigins)) {
    return c.json({ error: "不允许的请求来源" }, 403);
  }
  return next();
};

// 浏览器里的宿主（调试宿主、inspector）跨源访问需要 CORS；Origin 检查和 CORS 使用同一份白名单。
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
  // 根路径的发现端点（MCP 规范要求）：部分客户端不解析 WWW-Authenticate，直接请求 /.well-known
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
  // 父 app 的 strict 路由设置对子应用不生效，这里显式处理尾斜杠。
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

// token（OAuth 或 API key）只带 userId；每个请求都重新查询 email、角色和授权范围，不缓存，
// 管理员的修改立即生效。两种认证方式共用这一步，生成相同的 Cube securityContext。
async function resolvePrincipal(a: Auth, userId: string): Promise<Principal> {
  const ctx = await a.$context;
  return resolveBetterAuthPrincipal(ctx.internalAdapter, userId, semanticPackage.access_scope);
}

// /mcp 认证：Bearer token 先按 API key 校验，失败再按 OAuth session 校验。
// 未配置认证且 PA_ALLOW_OPEN=1 时，对能访问到服务的所有人开放。
// API key 每个请求都实时校验，吊销立即生效。
app.use("/mcp", async (c, next) => {
  if (!auth) {
    c.set("principal", LOCAL_PRINCIPAL);
    return next();
  }
  const enabledAuth = auth;
  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  // OAuth access token 也用 Bearer 传递：没有 API key 前缀的直接走下面的 session 校验。
  if (bearer?.startsWith(API_KEY_PREFIX)) {
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
  // 401 响应附带受保护资源元数据的地址。
  return c.json(
    { jsonrpc: "2.0", error: { code: -32001, message: "未授权：需要有效凭证" }, id: null },
    401,
    {
      "WWW-Authenticate": `Bearer resource_metadata="${config.baseUrl}/.well-known/oauth-protected-resource"`,
    },
  );
});

// Streamable HTTP 无状态模式：每个请求新建 server 和 transport
app.all("/mcp", async (c) => {
  const server = buildServer({ dependencies: serverDependencies, principal: c.get("principal") });
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(c);
});

// 导出下载时重新验证票据所有者，按当前权限即时生成 CSV；明细数据不写入磁盘。
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
    return c.text("导出失败（查询已失效或数据服务暂时不可用），请让助手重新生成链接。", 500);
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
