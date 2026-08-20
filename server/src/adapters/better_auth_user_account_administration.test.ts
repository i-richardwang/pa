import { expect, test } from "bun:test";
import { APIError } from "better-auth";
import type { Auth } from "../auth.js";
import type { UserAccountRequestError } from "../ports/user_account_administration.js";
import { createBetterAuthUserAccountAdministration } from "./better_auth_user_account_administration.js";

test("Better Auth 账号适配器封装持久化编码并只向应用层返回结构化授权", async () => {
  const calls: unknown[] = [];
  const stored = '{"scope_id":"region","kind":"limited","values":["North","West, D.C."]}';
  const user = {
    id: "u1",
    email: "user@example.com",
    name: "User",
    role: "user",
    access_scope: stored,
    banned: false,
  };
  const auth = {
    api: {
      listUsers: async (input: unknown) => {
        calls.push({ list: input });
        return { users: [user], total: 1 };
      },
      getUser: async () => user,
      createUser: async (input: unknown) => {
        calls.push({ create: input });
        return { user };
      },
      adminUpdateUser: async (input: unknown) => {
        calls.push({ update: input });
        return user;
      },
      setUserPassword: async (input: unknown) => {
        calls.push({ password: input });
        return { status: true };
      },
    },
  } as unknown as Auth;
  const headers = new Headers({ cookie: "session=test" });
  const accounts = createBetterAuthUserAccountAdministration(
    auth,
    { id: "region", title: "Region" },
    headers,
  );

  expect(await accounts.list()).toEqual([
    {
      id: "u1",
      email: "user@example.com",
      name: "User",
      role: "user",
      accessScope: { kind: "limited", values: ["North", "West, D.C."] },
      banned: false,
    },
  ]);
  await accounts.create({
    email: "new@example.com",
    password: "password123",
    name: "New",
    role: "user",
    accessScope: { kind: "all" },
  });
  await accounts.updateAuthorization("u1", {
    role: "admin",
    accessScope: { kind: "limited", values: ["North"] },
  });
  expect(calls).toMatchObject([
    { list: { headers } },
    {
      create: {
        headers,
        body: {
          data: { access_scope: '{"scope_id":"region","kind":"all"}' },
        },
      },
    },
    {
      update: {
        headers,
        body: {
          data: {
            role: "admin",
            access_scope: '{"scope_id":"region","kind":"limited","values":["North"]}',
          },
        },
      },
    },
  ]);
});

test("多角色账号按最高数据权限投影，避免管理员被误判为普通用户", async () => {
  const auth = {
    api: {
      listUsers: async () => ({
        users: [
          {
            id: "u1",
            email: "admin@example.com",
            name: "Admin",
            role: "user,admin",
            access_scope: '{"scope_id":"region","kind":"all"}',
          },
        ],
      }),
    },
  } as unknown as Auth;
  const accounts = createBetterAuthUserAccountAdministration(auth, {
    id: "region",
    title: "Region",
  });

  expect((await accounts.list())[0]?.role).toBe("admin");
});

test("Better Auth 的预期拒绝不越过适配器泄漏第三方错误", async () => {
  const auth = {
    api: {
      listUsers: async () => {
        throw new APIError("BAD_REQUEST", { message: "raw provider detail" });
      },
    },
  } as unknown as Auth;
  const accounts = createBetterAuthUserAccountAdministration(auth, {
    id: "region",
    title: "Region",
  });

  await expect(accounts.list()).rejects.toMatchObject({
    name: "UserAccountRequestError",
    message: "无法读取用户目录",
  } satisfies Partial<UserAccountRequestError>);
});
