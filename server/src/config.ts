import { normalizeAllowedOrigins } from "./engine/origins.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function parsePort(raw: string | undefined): number {
  const port = Number(raw ?? 8788);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT 无效：${raw}`);
  }
  return port;
}

function parseHost(raw: string | undefined): string {
  const host = raw?.trim() || "127.0.0.1";
  if (/[/\s]/.test(host)) throw new Error(`PA_BIND_HOST 无效：${raw}`);
  return host;
}

function parseBaseUrl(raw: string | undefined): string {
  const value = raw?.trim() || "http://127.0.0.1:8788";
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`PA_BASE_URL 只接受 origin（协议 + 主机 + 可选端口）：${value}`);
  }
  return url.origin;
}

export const config = {
  cubeUrl: process.env.CUBE_URL ?? "http://localhost:4000",
  apiSecret: required("CUBEJS_API_SECRET"),
  port: parsePort(process.env.PORT),
  /** Node 监听地址；Docker 宿主侧暴露地址另由 PA_SERVER_BIND_IP 控制。 */
  bindHost: parseHost(process.env.PA_BIND_HOST),
  /**
   * 鉴权基座（Better Auth）：设置 PA_AUTH_SECRET 即启用（openssl rand -hex 32）。
   * 是 OAuth 授权流与 API key（apiKey 插件）的共同前提——两条 /mcp 接入通道
   * （连接器走 OAuth，自动化脚本走用户自助签发的 key）都依赖它，同一套用户身份。
   * 未设且未显式放行即拒绝启动（fail-closed，见 index.ts）。
   */
  authSecret: process.env.PA_AUTH_SECRET,
  /** 鉴权基座未配置时的显式放行开关；表示部署者接受当前监听范围内无鉴权。 */
  allowOpen: process.env.PA_ALLOW_OPEN === "1",
  /** OAuth issuer、回跳与导出链接基址；公网部署时改为对外 HTTPS 地址 */
  baseUrl: parseBaseUrl(process.env.PA_BASE_URL),
  authDb: process.env.PA_AUTH_DB ?? "data/auth.db",
  appDb: process.env.PA_APP_DB ?? "data/app.db",
  /** 除 loopback 外额外放行的网页 origin，逗号分隔。 */
  allowedOrigins: normalizeAllowedOrigins(process.env.PA_ALLOWED_ORIGINS),
};
