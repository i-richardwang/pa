import { requireMcpAuth } from "@better-auth/mcp";
import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { APIError } from "better-auth";
import { API_KEY_PREFIX, type Auth } from "../auth.js";
import type { AccessScopeDefinition } from "../contracts/access_scope.js";
import { MCP_ACCESS_SCOPE, mcpResourceUrl } from "../contracts/mcp_access.js";
import type { Principal } from "../contracts/principal.js";
import type { Logger } from "../ports/logger.js";
import { resolveBetterAuthPrincipal } from "./better_auth_principal.js";

type McpAuthentication = {
  auth: Auth;
  accessScope: AccessScopeDefinition;
  logger: Logger;
};

export function authenticateMcp(
  { auth, accessScope, logger }: McpAuthentication,
  serve: (request: Request, principal: Principal) => Promise<Response>,
) {
  const resource = mcpResourceUrl(auth.options.baseURL);

  function unauthorized(request: Request) {
    const error = new APIError("UNAUTHORIZED", {
      error: "invalid_token",
      message: "凭证无效或账号不可用",
    });
    const challenge = createResourceServerChallenge(error, resource, {
      request,
      challengeScopes: [MCP_ACCESS_SCOPE],
    });
    return rpcError(401, error.message, challenge?.headers);
  }

  async function serveUser(request: Request, userId: string | undefined) {
    if (!userId) return unauthorized(request);
    const { internalAdapter } = await auth.$context;
    const principal = await resolveBetterAuthPrincipal(internalAdapter, userId, accessScope);
    if (!principal) return unauthorized(request);
    logger.info(`${principal.email} ${request.method} /mcp`);
    return serve(request, principal);
  }

  const oauth = requireMcpAuth(auth, (request, claims) => serveUser(request, claims.sub), {
    resource,
    requiredScopes: [MCP_ACCESS_SCOPE],
  });
  return async (request: Request) => {
    const bearer = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer?.startsWith(API_KEY_PREFIX)) return oauth(request);
    const verified = await auth.api.verifyApiKey({ body: { key: bearer } });
    if (verified.error?.code === "RATE_LIMITED") return rpcError(429, "API Key 已达到请求频率限制");
    if (!verified.valid || !verified.key) return unauthorized(request);
    return serveUser(request, verified.key.referenceId);
  };
}

function rpcError(status: number, message: string, headers?: HeadersInit) {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message }, id: null },
    { status, headers },
  );
}
