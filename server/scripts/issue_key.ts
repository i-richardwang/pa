/**
 * 无头签发 API Key（CI / smoke / 无浏览器的脚本接入场景）：
 * bun run key:issue -- <email> [名称]
 * 服务端直调 apiKey 插件 createApiKey（不经 HTTP、无会话要求），key 绑该用户身份，
 * 明文只打印一次——存入 .env 的 PA_MCP_API_KEY 或客户端配置的 Authorization 头。
 * 与控制台内自助签发完全等价，仅为无浏览器环境提供 bootstrap 入口。
 * key 以 SHA-256 散列入库（apiKey 插件默认 hasher，不依赖 PA_AUTH_SECRET），
 * 故离线签发的 key 与运行中服务算得同一散列、可直接校验通过。
 * 注意：容器内服务持长连接，跨 Docker 挂载的新写入对其不可见（virtiofs 缓存），
 * 签发后须 docker compose restart server 生效。
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
  console.error(`未找到用户：${email}（先 bun run user:create 开通该账号）`);
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
