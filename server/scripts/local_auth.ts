import { randomBytes } from "node:crypto";
import { openAuth } from "../src/auth.js";

/** 离线账号命令只写账号和密钥散列，不签发会话或 OAuth 令牌。 */
export function openLocalAuth() {
  return openAuth({
    baseUrl: process.env.PA_BASE_URL ?? "http://127.0.0.1:8788",
    dbPath: process.env.PA_AUTH_DB ?? "data/auth.db",
    secret: process.env.PA_AUTH_SECRET || randomBytes(32).toString("base64url"),
  });
}
