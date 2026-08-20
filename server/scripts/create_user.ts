/**
 * 用户开通（管理员在本机执行）：
 *   bun run user:create -- <email> <password> [显示名] [--admin] \
 *     [--org-scope=<组织清单|*>] [--with-key]
 * 写入与服务同一 SQLite 文件（PA_AUTH_DB，默认 data/auth.db，相对 server/ 目录）。
 * 服务端无自助注册，本脚本是唯一开通入口。
 *
 * 授权（见 src/engine/cube_security.ts 与 view.access_policy）:
 * --admin 设为管理员；省略时为普通分析用户。
 * --org-scope 行权限——有权组织的 organization_name 清单（逗号分隔）或 "*" 全量；
 *             缺省为空，账号可登录但不能查询数据。
 * --with-key 开通后签发一枚绑定该用户的 API key；明文只打印一次。
 *
 * 经 admin 插件的 createUser 与 apiKey 插件的 createApiKey 端点（服务端直调不经 HTTP、
 * 无会话要求）；org_scope 经 Better Auth 用户范围适配器写入（input:false 字段）。密码散列（scrypt）
 * 与 key 散列（SHA-256）均不依赖 PA_AUTH_SECRET。
 * 注意：容器内服务持有长连接，跨 Docker 挂载边界的新写入对其不可见（virtiofs 缓存），
 * 开通后须 docker compose restart server 生效。
 */
import { buildAuth, initializeAuthSchema } from "../src/auth.js";
import { createBetterAuthUserScopeWriter } from "../src/adapters/better_auth_user_scope.js";
import { openSqlite } from "../src/sqlite.js";

const argv = process.argv.slice(2);
const opts = new Map<string, string>();
const positional: string[] = [];
for (const a of argv) {
  if (a.startsWith("--")) {
    const eq = a.indexOf("=");
    opts.set(eq >= 0 ? a.slice(2, eq) : a.slice(2), eq >= 0 ? a.slice(eq + 1) : "");
  } else {
    positional.push(a);
  }
}
const [email, password, name] = positional;
if (!email || !password) {
  console.error(
    "用法：bun run user:create -- <email> <password> [显示名] " +
      "[--admin] [--org-scope=<组织清单|*>] [--with-key]",
  );
  process.exit(1);
}

const role = opts.has("admin") ? "admin" : "user";
const orgScope = opts.get("org-scope") ?? "";
const withKey = opts.has("with-key");

const cfg = {
  baseUrl: process.env.PA_BASE_URL ?? "http://127.0.0.1:8788",
  secret: process.env.PA_AUTH_SECRET ?? "create-user-offline",
  dbPath: process.env.PA_AUTH_DB ?? "data/auth.db",
  allowSignUp: true,
};

const authDb = await openSqlite(cfg.dbPath);
await initializeAuthSchema(cfg, authDb);
const auth = buildAuth(cfg, authDb);
const res = await auth.api.createUser({
  body: { email, password, name: name ?? email.split("@")[0], role },
});
await createBetterAuthUserScopeWriter(auth).setOrgScope(res.user.id, orgScope);
console.log(
  `已开通：${res.user.email}（id=${res.user.id}，角色=${role}，` +
    `组织权限=${orgScope || "（空:无行权限,待授组织）"}）`,
);

if (withKey) {
  const key = await auth.api.createApiKey({ body: { name: "onboarding", userId: res.user.id } });
  console.log("API Key（明文仅此一次，请妥善保管）：");
  console.log(key.key);
}
console.log("服务容器正在运行时，需 docker compose restart server 使新用户生效。");
authDb.close();
