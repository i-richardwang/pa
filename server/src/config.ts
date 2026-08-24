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

/** 未设置时返回 undefined，由消费方决定默认值——默认值只归它一处。 */
function optionalPositiveInteger(name: string, raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数：${raw}`);
  return value;
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
  cubeRequestTimeoutMs: optionalPositiveInteger(
    "PA_CUBE_REQUEST_TIMEOUT_MS",
    process.env.PA_CUBE_REQUEST_TIMEOUT_MS,
  ),
  port: parsePort(process.env.PORT),
  /** Node 监听地址；Docker 宿主侧暴露地址另由 PA_SERVER_BIND_IP 控制。 */
  bindHost: parseHost(process.env.PA_BIND_HOST),
  /** OAuth 与 API key 两条 /mcp 通道的共同前提；未设且未放行即拒绝启动。 */
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
