/**
 * 在命令行为用户签发 API Key，用于 CI、smoke 或没有浏览器的脚本接入。
 * 直接调用 Better Auth apiKey 插件的 createApiKey（不经过 HTTP，也不需要登录会话），key 绑定该用户。
 * key 以 SHA-256 散列保存（插件默认做法，与 PA_AUTH_SECRET 无关），所以离线签发的 key 运行中的服务也能校验。
 * 注意：容器内的服务一直打开着数据库，Docker 挂载目录的新写入对它不可见（virtiofs 缓存），
 * 签发后要执行 docker compose restart server 才生效。
 */
import { buildAuth, initializeAuthSchema } from "../src/auth.js";
import { openSqlite } from "../src/sqlite.js";

const [email, name] = process.argv.slice(2);
if (!email) {
  console.error("用法：bun run key:issue -- <email> [名称]");
  process.exit(1);
}

const cfg = {
  baseUrl: process.env.PA_BASE_URL ?? "http://127.0.0.1:8788",
  secret: process.env.PA_AUTH_SECRET ?? "issue-key-offline",
  dbPath: process.env.PA_AUTH_DB ?? "data/auth.db",
};

const authDb = await openSqlite(cfg.dbPath);
await initializeAuthSchema(cfg, authDb);
const auth = buildAuth(cfg, authDb);
const ctx = await auth.$context;
const found = await ctx.internalAdapter.findUserByEmail(email.toLowerCase());
if (!found) {
  console.error(`未找到用户：${email}（请先用 bun run user:create 创建该账号）`);
  authDb.close();
  process.exit(1);
}

const res = await auth.api.createApiKey({
  body: { name: name ?? "cli", userId: found.user.id },
});
console.log(`已为 ${email} 签发 API Key（id=${res.id}）。明文仅此一次，请立即保存：`);
console.log(res.key);
console.log(
  "用法：export PA_MCP_API_KEY=<上面的 key>，或写入客户端配置的 Authorization: Bearer 头。",
);
authDb.close();
