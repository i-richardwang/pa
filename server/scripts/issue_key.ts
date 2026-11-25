/** 本机管理员为已有账号签发 API Key，明文仅输出一次。 */
import { openLocalAuth } from "./local_auth.js";

const [email, name] = process.argv.slice(2);
if (!email) {
  console.error("用法：bun run key:issue -- <email> [名称]");
  process.exit(1);
}

const { auth, db: authDb } = await openLocalAuth();
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
