import { apiKey } from "@better-auth/api-key";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { admin, jwt } from "better-auth/plugins";
import { MCP_ACCESS_SCOPE, mcpResourceUrl } from "./contracts/mcp_access.js";
import { isAllowedOrigin } from "./engine/origins.js";
import { openSqlite, type SqliteDatabase } from "./sqlite.js";

/** apiKey 插件的 key 前缀；/mcp 根据它区分 API key 和 OAuth access token。 */
export const API_KEY_PREFIX = "pa_";
/** 由 HTTP 入口从 socket 对端地址写入，供 Better Auth 的会话和限流使用。 */
export const AUTH_PEER_IP_HEADER = "x-pa-peer-ip";

type AuthConfig = {
  baseUrl: string;
  secret: string;
  dbPath: string;
  allowedOrigins?: string[];
};

function authOptions(cfg: AuthConfig, db: SqliteDatabase) {
  // Better Auth 适配器直接支持 node:sqlite 和 bun:sqlite 实例
  const database = db as BetterAuthOptions["database"];
  return {
    baseURL: cfg.baseUrl,
    disabledPaths: ["/token"],
    advanced: { ipAddress: { ipAddressHeaders: [AUTH_PEER_IP_HEADER] } },
    secret: cfg.secret,
    database,
    telemetry: { enabled: false },
    // 除 baseURL 外，只信任 loopback 和 PA_ALLOWED_ORIGINS 中声明的来源。
    trustedOrigins: (request: Request | undefined) => {
      const origin = request?.headers.get("origin");
      return isAllowedOrigin(origin, cfg.allowedOrigins) ? [origin] : [];
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
    },
    // access_scope 以字符串存在 Better Auth 用户表里；应用解析后写进 Cube JWT 的 data_scope。
    // input:false：用户不能自己修改，只能由管理员或开通命令写入。
    user: {
      additionalFields: {
        access_scope: { type: "string", required: false, defaultValue: "", input: false },
      },
    },
    // user.role 决定控制台的访问级别；角色和数据范围在同一次用户管理操作中提交。
    // apiKey 提供 /mcp bearer 认证用的 key，key 绑定到签发它的登录用户。
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        resource: mcpResourceUrl(cfg.baseUrl),
        loginPage: "/login",
        consentPage: "/consent",
        scopes: [MCP_ACCESS_SCOPE, "offline_access", "openid", "profile", "email"],
        schema: {
          oauthClient: { modelName: "oauth_client" },
          oauthResource: { modelName: "oauth_resource" },
          oauthClientResource: { modelName: "oauth_client_resource" },
          oauthAccessToken: { modelName: "oauth_access_token" },
          oauthRefreshToken: { modelName: "oauth_refresh_token" },
          oauthConsent: { modelName: "oauth_consent" },
          oauthClientAssertion: { modelName: "oauth_client_assertion" },
        },
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: "infer",
        refreshTokenReuseInterval: 0,
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
      admin(),
      apiKey({ defaultPrefix: API_KEY_PREFIX, rateLimit: { enabled: true } }),
    ],
  } satisfies BetterAuthOptions;
}

export async function openAuth(cfg: AuthConfig) {
  const db = await openSqlite(cfg.dbPath);
  try {
    const options = authOptions(cfg, db);
    const { runMigrations } = await getMigrations(options);
    await runMigrations();
    return { auth: betterAuth(options), db };
  } catch (error) {
    db.close();
    throw error;
  }
}

export type Auth = Awaited<ReturnType<typeof openAuth>>["auth"];
