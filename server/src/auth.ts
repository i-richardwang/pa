/**
 * Better Auth 实例：mcp 插件让本服务自身成为 OAuth 授权服务器（MCP 规范的认证形态，
 * 也是 MCP 客户端连接器接入的硬前提——连接器只认 OAuth，无 API key 入口）；
 * apiKey 插件让用户自助签发绑定本人身份的 key，OAuth 与 API key 的 caller 均为属主 email。
 * 存储为 SQLite 单文件（运行时内置驱动，无原生依赖）；表结构在服务启动时初始化。
 * 无自助注册：用户由管理员通过管理界面或受控命令开通。
 */
import { apiKey } from "@better-auth/api-key";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { admin, mcp } from "better-auth/plugins";
import { isAllowedOrigin } from "./engine/origins.js";
import type { SqliteDatabase } from "./sqlite.js";

/** apiKey 插件的 key 前缀；/mcp 据此把 API key 与 OAuth access token 分流。 */
export const API_KEY_PREFIX = "pa_";

export type AuthConfig = {
  baseUrl: string;
  secret: string;
  dbPath: string;
  allowedOrigins?: string[];
  /** 仅开通脚本置 true；服务端注册端点始终关闭 */
  allowSignUp?: boolean;
};

function authOptions(cfg: AuthConfig, db: SqliteDatabase) {
  // node:sqlite / bun:sqlite 实例均为 Better Auth 适配器官方识别的类型
  const database = db as BetterAuthOptions["database"];
  return {
    baseURL: cfg.baseUrl,
    secret: cfg.secret,
    database,
    telemetry: { enabled: false },
    // baseURL 之外，仅反射 loopback 或 PA_ALLOWED_ORIGINS 明确声明的来源。
    trustedOrigins: (request: Request | undefined) => {
      const origin = request?.headers.get("origin");
      return isAllowedOrigin(origin, cfg.allowedOrigins) ? [origin] : [];
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !cfg.allowSignUp,
    },
    // access_scope 是 Better Auth 的持久化适配字段；领域层解析为判别联合，Cube JWT 投影为 data_scope。
    // input:false = 非自助字段，仅由管理员用户管理用例或受控命令写入。
    user: {
      additionalFields: {
        access_scope: { type: "string", required: false, defaultValue: "", input: false },
      },
    },
    // user.role 是控制台 /dashboard 分层依据，角色与数据范围由同一个用户管理动作提交。
    // apiKey 是 /mcp bearer 通道的 key 来源：key 绑 session 用户，与角色同一套用户身份。
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

/** 初始化 Better Auth 管理的表结构。 */
export async function initializeAuthSchema(cfg: AuthConfig, db: SqliteDatabase): Promise<void> {
  const { runMigrations } = await getMigrations(authOptions(cfg, db));
  await runMigrations();
}
