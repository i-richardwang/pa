import { expect, test } from "bun:test";
import { resolveBetterAuthPrincipal } from "./better_auth_principal.js";

const ACCESS_SCOPE = { id: "organization", title: "组织" };

test("按用户当前属性解析出角色与数据范围", async () => {
  const principal = await resolveBetterAuthPrincipal(
    {
      findUserById: async () => ({
        email: "alice@example.com",
        role: "user",
        access_scope: JSON.stringify({
          scope_id: "organization",
          kind: "limited",
          values: ["研发"],
        }),
      }),
    },
    "user-1",
    ACCESS_SCOPE,
  );
  expect(principal).toEqual({
    email: "alice@example.com",
    roles: ["user"],
    accessScope: { kind: "limited", values: ["研发"] },
  });
});

test("已删除的账号无法通过 MCP 认证", async () => {
  expect(
    await resolveBetterAuthPrincipal(
      { findUserById: async () => null },
      "deleted-user",
      ACCESS_SCOPE,
    ),
  ).toBeNull();
});

test.each([
  [null, false],
  [new Date("9999-01-01"), false],
  [new Date("2000-01-01"), true],
] as const)("封禁截止时间 %s 的账号可访问 MCP 为 %s", async (banExpires, allowed) => {
  const account = { email: "member@example.test", role: "admin", banned: true, banExpires };
  const principal = await resolveBetterAuthPrincipal(
    { findUserById: async () => account },
    "member",
    ACCESS_SCOPE,
  );
  expect(principal?.email ?? null).toBe(allowed ? account.email : null);
});

test("账号查询失败保留原始异常", async () => {
  const failure = new Error("auth database unavailable");
  await expect(
    resolveBetterAuthPrincipal(
      {
        findUserById: async () => {
          throw failure;
        },
      },
      "user-1",
      ACCESS_SCOPE,
    ),
  ).rejects.toBe(failure);
});
