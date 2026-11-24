import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { requireMcpAuth } from "@better-auth/mcp";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { html } from "hono/html";
import { cors } from "hono/cors";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { principalFromAttributes, type Principal } from "./contracts/principal.js";
import {
  API_KEY_PREFIX,
  AUTH_PEER_IP_HEADER,
  buildAuth,
  initializeAuthSchema,
  type Auth,
} from "./auth.js";
import { consoleLogger as logger } from "./adapters/console_logger.js";
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

const app = new Hono();

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
  logger,
});
const serverDependencies: McpServerDependencies = {
  logger,
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

app.use(async (c, next) => {
  const { address } = getConnInfo(c).remote;
  const headers = c.req.raw.headers;
  if (address) headers.set(AUTH_PEER_IP_HEADER, address);
  else headers.delete(AUTH_PEER_IP_HEADER);
  return next();
});

app.get("/healthz", (c) => c.json({ ok: true }));

const configuredOrigins = [new URL(config.baseUrl).origin, ...config.allowedOrigins];
const originGuard: MiddlewareHandler = async (c, next) => {
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
  allowMethods: ["GET", "HEAD", "POST", "DELETE", "OPTIONS"],
  exposeHeaders: [
    "Mcp-Session-Id",
    "Mcp-Protocol-Version",
    "Mcp-Wire-Codec",
    "WWW-Authenticate",
    "DPoP-Nonce",
  ],
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
  app.on(["GET", "HEAD"], "/.well-known/*", (c) => enabledAuth.handler(c.req.raw));
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
  app.get("/consent", async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    const query = new URL(c.req.url).searchParams;
    const { secret } = await enabledAuth.$context;
    if (!(await verifyOAuthQueryParams(query.toString(), secret)))
      return c.text("授权请求无效或已过期", 400);
    const clientId = query.get("client_id");
    if (!clientId) return c.text("授权请求缺少客户端标识", 400);
    const result = await enabledAuth.api.getOAuthClientPublic({
      query: { client_id: clientId },
      headers: c.req.raw.headers,
      asResponse: true,
    });
    if (!result.ok)
      return c.text("授权请求不可用，请从客户端重新连接", result.status === 401 ? 401 : 400);
    const client = (await result.json()) as { client_name?: string };
    const meta =
      await html`<meta name="pa-oauth-client" content="${client.client_name ?? clientId}">`;
    return c.html(
      (await loginHtml()).replace(/<meta name="pa-oauth-client"\s*\/?>/, () => meta.toString()),
    );
  });
  app.get("/login", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.html(await loginHtml());
  });
  // 父 app 的 strict 路由设置对子应用不生效，这里显式处理尾斜杠。
  app.get("/dashboard/", (c) => c.redirect("/dashboard"));
  app.route(
    "/dashboard",
    dashboardRoutes({
      logger,
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

function handleMcp(request: Request, principal: Principal) {
  return createMcpHandler(() => buildServer({ dependencies: serverDependencies, principal })).fetch(
    request,
  );
}

const enabledAuth = auth;
const oauthMcp =
  enabledAuth &&
  requireMcpAuth(
    enabledAuth,
    async (request, claims) => {
      if (!claims.sub) return new Response(null, { status: 401 });
      return handleMcp(request, await resolvePrincipal(enabledAuth, claims.sub));
    },
    { resource: new URL("/mcp", config.baseUrl).href, requiredScopes: ["mcp"] },
  );

app.all("/mcp", async (c) => {
  if (!enabledAuth || !oauthMcp) return handleMcp(c.req.raw, LOCAL_PRINCIPAL);
  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer?.startsWith(API_KEY_PREFIX)) {
    const verified = await enabledAuth.api
      .verifyApiKey({ body: { key: bearer } })
      .catch(() => null);
    if (verified?.error?.code === "RATE_LIMITED") {
      return c.json(
        {
          jsonrpc: "2.0",
          error: { code: -32000, message: "API Key 已达到请求频率限制" },
          id: null,
        },
        429,
      );
    }
    if (verified?.valid && verified.key) {
      const principal = await resolvePrincipal(enabledAuth, verified.key.referenceId);
      logger.info(`${principal.email} ${c.req.method} /mcp (api key)`);
      return handleMcp(c.req.raw, principal);
    }
  }
  return oauthMcp(c.req.raw);
});

// 导出下载时重新验证票据所有者，按当前权限即时生成 CSV；明细数据不写入磁盘。
const exportDownload = async (c: Context) => {
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
    logger.error("导出失败", e);
    return c.text("导出失败（查询已失效或数据服务暂时不可用），请让助手重新生成链接。", 500);
  }
};
app.get("/export/:ticket", exportDownload);

const httpServer = serve(
  { fetch: app.fetch, port: config.port, hostname: config.bindHost },
  (info) => {
    logger.info(
      `listening on ${config.bindHost}:${info.port} ` +
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
