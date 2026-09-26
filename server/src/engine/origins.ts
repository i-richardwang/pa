/** MCP Origin 校验、CORS 与 Better Auth trustedOrigins 使用同一套规则。 */

export function isLocalOrigin(origin: string | null | undefined): origin is string {
  if (typeof origin !== "string") return false;
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) return false;
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

export function normalizeAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          const url = new URL(value);
          if (
            url.origin === "null" ||
            url.username ||
            url.password ||
            url.pathname !== "/" ||
            url.search ||
            url.hash
          ) {
            throw new Error(`PA_ALLOWED_ORIGINS 只接受 origin（协议 + 主机 + 可选端口）：${value}`);
          }
          return url.origin;
        }),
    ),
  ];
}

export function isAllowedOrigin(
  origin: string | null | undefined,
  configured: readonly string[] = [],
): origin is string {
  return isLocalOrigin(origin) || (typeof origin === "string" && configured.includes(origin));
}
