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

test("用户不存在时返回无权限主体，查询出错时抛出原始异常", async () => {
  await expect(
    resolveBetterAuthPrincipal({ findUserById: async () => null }, "deleted-user", ACCESS_SCOPE),
  ).resolves.toEqual({
    email: "deleted-user",
    roles: [],
    accessScope: { kind: "limited", values: [] },
  });

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
