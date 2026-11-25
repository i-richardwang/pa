import { useState } from "react";
import { MCP_ACCESS_SCOPE } from "@contracts/mcp_access";
import { Button } from "@/components/ui/button";
import { authClient } from "./auth_client";

const scopeTitles: Record<string, string> = {
  [MCP_ACCESS_SCOPE]: "按你的数据权限使用 PA 分析工具",
  offline_access: "在本次会话结束后继续访问",
  openid: "确认你的账号身份",
  profile: "读取账号资料",
  email: "读取邮箱地址",
};

export async function loadConsentRequest(query: URLSearchParams) {
  const clientId = query.get("client_id");
  const redirectUri = query.get("redirect_uri");
  if (!clientId || !redirectUri) return null;
  const { data: client } = await authClient.oauth2.publicClient({ query: { client_id: clientId } });
  if (!client) return null;
  const claims = JSON.parse(query.get("claims") ?? "{}") as { userinfo?: Record<string, unknown> };
  return {
    clientName: client.client_name ?? clientId,
    clientId,
    redirectUri,
    scopes: (query.get("scope") ?? "").split(/\s+/).filter(Boolean),
    userInfoClaims: Object.keys(claims.userinfo ?? {}),
  };
}

export function ConsentPage({
  request,
}: {
  request: Awaited<ReturnType<typeof loadConsentRequest>>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!request)
    return (
      <main role="alert" className="p-6 text-pa-fg">
        授权请求不可用，请从客户端重新连接。
      </main>
    );
  const { clientId, clientName, redirectUri, scopes, userInfoClaims } = request;
  async function decide(accept: boolean) {
    setPending(true);
    try {
      const result = await authClient.oauth2.consent({ accept });
      if (!result.error && result.data?.redirect) return;
    } catch {
      // 网络错误和过期的授权请求都应允许用户重新尝试。
    }
    setError("提交失败，请重试或从客户端重新连接。");
    setPending(false);
  }
  return (
    <main className="flex min-h-svh items-center justify-center bg-pa-canvas px-6 py-10 text-pa-fg">
      <section className="flex w-full max-w-sm flex-col gap-5">
        <h1 className="font-serif text-3xl">授权客户端访问 PA</h1>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-pa-muted">客户端自报名称</dt>
            <dd className="break-all">{clientName}</dd>
          </div>
          <div>
            <dt className="text-pa-muted">客户端标识</dt>
            <dd className="break-all">{clientId}</dd>
          </div>
          <div>
            <dt className="text-pa-muted">授权后返回</dt>
            <dd className="break-all">{redirectUri}</dd>
          </div>
          <div>
            <dt className="text-pa-muted">申请的权限</dt>
            <dd>
              <ul>
                {scopes.map((scope) => (
                  <li key={scope}>{scopeTitles[scope] ?? scope}</li>
                ))}
              </ul>
            </dd>
          </div>
          {userInfoClaims.length > 0 && (
            <div>
              <dt className="text-pa-muted">申请的账号信息</dt>
              <dd>{userInfoClaims.join("、")}</dd>
            </div>
          )}
        </dl>
        {error && (
          <p role="alert" className="text-sm text-pa-danger-fg">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <Button disabled={pending} onClick={() => void decide(true)}>
            允许访问
          </Button>
          <Button variant="subtle" disabled={pending} onClick={() => void decide(false)}>
            拒绝
          </Button>
        </div>
      </section>
    </main>
  );
}
