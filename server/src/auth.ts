/**
 * Better Auth 实例。mcp 插件让本服务作为 OAuth 授权服务器：MCP 客户端连接器只支持 OAuth，
 * 不支持 API key。apiKey 插件让用户自己签发绑定本人身份的 key；两种方式的调用者都是 key 所有者的 email。
 * 不开放自助注册，用户由管理员在管理界面或用命令开通。
 */
import { apiKey } from "@better-auth/api-key";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { admin, mcp } from "better-auth/plugins";
import { isAllowedOrigin } from "./engine/origins.js";
import type { SqliteDatabase } from "./sqlite.js";

/** apiKey 插件的 key 前缀；/mcp 根据它区分 API key 和 OAuth access token。 */
export const API_KEY_PREFIX = "pa_";

export type AuthConfig = {
  baseUrl: string;
  secret: string;
  dbPath: string;
  allowedOrigins?: string[];
  /** 只有开通用户的脚本设为 true；服务端的注册端点始终关闭 */
  allowSignUp?: boolean;
};

function authOptions(cfg: AuthConfig, db: SqliteDatabase) {
  // Better Auth 适配器直接支持 node:sqlite 和 bun:sqlite 实例
  const database = db as BetterAuthOptions["database"];
  return {
    baseURL: cfg.baseUrl,
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
      disableSignUp: !cfg.allowSignUp,
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
      mcp({ loginPage: "/login" }),
      admin(),
      apiKey({ defaultPrefix: API_KEY_PREFIX, rateLimit: { enabled: true } }),
    ],
  } satisfies BetterAuthOptions;
}

export function buildAuth(cfg: AuthConfig, db: SqliteDatabase) {
  return betterAuth(authOptions(cfg, db));
}

export type Auth = ReturnType<typeof buildAuth>;

export async function initializeAuthSchema(cfg: AuthConfig, db: SqliteDatabase): Promise<void> {
  const { runMigrations } = await getMigrations(authOptions(cfg, db));
  await runMigrations();
}
