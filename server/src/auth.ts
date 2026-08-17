/**
 * Better Auth 实例：mcp 插件让本服务自身成为 OAuth 授权服务器（MCP 规范的认证形态，
 * 也是 MCP 客户端连接器接入的硬前提——连接器只认 OAuth，无 API key 入口）；
 * apiKey 插件让用户自助签发绑定本人身份的 key，OAuth 与 API key 的 caller 均为属主 email。
 * 存储为 SQLite 单文件（运行时内置驱动，无原生依赖）；表结构在服务启动时初始化。
 * 无自助注册：用户由管理员经 scripts/create_user.ts 开通。
 */
import { apiKey } from "@better-auth/api-key";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { admin, mcp } from "better-auth/plugins";
import { isAllowedOrigin } from "./engine/origins.js";
import type { SqliteDatabase } from "./sqlite.js";

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
    // Cube access_policy 的行权限属性:有权组织的 organization_name 清单——"*"=全量、""=无权（fail-closed）、
    // 否则逗号分隔（一级组织名无逗号）。input:false = 非自助字段,仅管理员经 admin 端点/脚本写。
    user: {
      additionalFields: {
        org_scope: { type: "string", required: false, defaultValue: "", input: false },
      },
    },
    // admin 插件 = 角色模型（user.role，默认 admin/user 两角色）：
    // 控制台 /dashboard 按角色分层的依据；用户开通/晋升角色经 scripts/create_user.ts。
    // apiKey 插件 = /mcp bearer 通道的 key 来源：key 绑 session 用户，自助创建/吊销；
    plugins: [
      mcp({ loginPage: "/login" }),
      admin(),
      apiKey({ defaultPrefix: "pa_", rateLimit: { enabled: true } }),
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
