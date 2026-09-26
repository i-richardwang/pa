/**
 * 由管理员在本机创建用户，写入服务使用的同一个 SQLite 文件（PA_AUTH_DB，默认 data/auth.db，
 * 相对 server/ 目录）。服务没有自助注册，账号只能通过这个脚本创建。
 *
 * 数据权限规则见 src/engine/cube_security.ts 和 view 的 access_policy；不传 --data-scope 时，
 * 账号可以登录，但查不到任何数据。
 *
 * 通过用户账号适配器和 apiKey 插件直接写入（不经过 HTTP，也不需要登录会话），同时保存绑定当前
 * 语义包的数据权限范围。密码散列（scrypt）和 key 散列（SHA-256）都与 PA_AUTH_SECRET 无关。
 * 注意：容器内的服务一直打开着数据库，Docker 挂载目录的新写入对它不可见（virtiofs 缓存），
 * 创建后要执行 docker compose restart server 才生效。
 */
import { buildAuth, initializeAuthSchema } from "../src/auth.js";
import { createBetterAuthUserAccountAdministration } from "../src/adapters/better_auth_user_account_administration.js";
import {
  configuredSemanticPackageDir,
  loadSemanticPackage,
} from "../src/engine/semantic_package.js";
import { openSqlite } from "../src/sqlite.js";

const argv = process.argv.slice(2);
const opts = new Map<string, string>();
const accessScopeValues: string[] = [];
const positional: string[] = [];
for (const a of argv) {
  if (a.startsWith("--")) {
    const eq = a.indexOf("=");
    const key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    const value = eq >= 0 ? a.slice(eq + 1) : "";
    if (key === "data-scope") accessScopeValues.push(value.trim());
    else opts.set(key, value);
  } else {
    positional.push(a);
  }
}
const [email, password, name] = positional;
if (!email || !password) {
  console.error(
    "用法：bun run user:create -- <email> <password> [显示名] " +
      "[--admin] [--data-scope=<授权值>]... [--data-scope=*] [--with-key]",
  );
  process.exit(1);
}

const role = opts.has("admin") ? "admin" : "user";
if (accessScopeValues.includes("*") && accessScopeValues.length > 1) {
  throw new Error("--data-scope=* 不能与限定值同时使用");
}
const accessScope =
  accessScopeValues[0] === "*"
    ? ({ kind: "all" } as const)
    : {
        kind: "limited" as const,
        values: accessScopeValues.filter(Boolean),
      };
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
const semanticPackage = await loadSemanticPackage(configuredSemanticPackageDir());
const accounts = createBetterAuthUserAccountAdministration(auth, semanticPackage.access_scope);
const user = await accounts.create({
  email,
  password,
  name: name ?? email.split("@")[0] ?? email,
  role,
  accessScope,
});
console.log(
  `已创建：${user.email}（id=${user.id}，角色=${role}，` +
    `数据范围=${accessScopeValues.join("、") || "（未设置：可以登录，但查不到数据）"}）`,
);

if (withKey) {
  const key = await auth.api.createApiKey({ body: { name: "onboarding", userId: user.id } });
  console.log("API Key（明文仅此一次，请妥善保管）：");
  console.log(key.key);
}
console.log("服务容器正在运行时，需 docker compose restart server 使新用户生效。");
authDb.close();
