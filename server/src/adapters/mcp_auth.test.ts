import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { openAuth } from "../auth.js";
import { authenticateMcp } from "./mcp_auth.js";

test("MCP 的 API Key 只为当前可用的账号建立主体，拒绝时提供资源发现地址", async () => {
  const baseUrl = "http://127.0.0.1:8788";
  const { auth, db } = await openAuth({
    baseUrl,
    dbPath: ":memory:",
    secret: randomBytes(32).toString("base64url"),
  });
  try {
    const { user } = await auth.api.createUser({
      body: { name: "Demo", email: "member@example.test", password: "local-test-password" },
    });
    const { key } = await auth.api.createApiKey({ body: { userId: user.id, name: "demo" } });
    const { internalAdapter } = await auth.$context;
    const handle = authenticateMcp(
      {
        auth,
        accessScope: { id: "organization", title: "组织" },
        logger: { info() {}, error() {} },
      },
      async (_request, principal) => Response.json(principal.email),
    );
    const request = () =>
      new Request(new URL("/mcp", baseUrl), {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
      });
    expect(await (await handle(request())).json()).toEqual(user.email);
    await internalAdapter.updateUser(user.id, { banned: true });
    const denied = await handle(request());
    expect(denied.status).toBe(401);
    expect(denied.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp"`,
    );
    await internalAdapter.updateUser(user.id, { banned: false });
    expect(await (await handle(request())).json()).toEqual(user.email);
  } finally {
    db.close();
  }
});
