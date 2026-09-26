import { describe, expect, test } from "bun:test";
import type { Principal } from "../contracts/principal.js";
import type {
  UserAccount,
  UserAccountAdministration,
} from "../ports/user_account_administration.js";
import { UserAccountRequestError } from "../ports/user_account_administration.js";
import { ForbiddenError, InvalidRequestError, type UnavailableError } from "./errors.js";
import { createUserAdministrationService } from "./user_administration_service.js";

const admin: Principal = {
  email: "admin@example.com",
  roles: ["admin"],
  accessScope: { kind: "all" },
};
const user: Principal = {
  email: "user@example.com",
  roles: ["user"],
  accessScope: { kind: "all" },
};

const account = (overrides: Partial<UserAccount> = {}): UserAccount => ({
  id: "u1",
  email: "analyst@example.com",
  name: "Analyst",
  role: "user",
  accessScope: { kind: "limited", values: ["North"] },
  banned: false,
  ...overrides,
});

function harness() {
  const calls: unknown[] = [];
  const accounts: UserAccountAdministration = {
    list: async () => [account()],
    get: async (userId) => account({ id: userId }),
    create: async (input) => {
      calls.push({ create: input });
      return account({
        email: input.email,
        name: input.name,
        role: input.role,
        accessScope: input.accessScope,
      });
    },
    updateAuthorization: async (userId, input) => {
      calls.push({ updateAuthorization: { userId, ...input } });
      return account({ id: userId, role: input.role, accessScope: input.accessScope });
    },
    resetPassword: async (userId, password) => {
      calls.push({ resetPassword: { userId, password } });
    },
  };
  return { service: createUserAdministrationService({ accounts }), calls, accounts };
}

describe("user administration service", () => {
  test("列表返回账号字段，创建时一次提交角色与去重后的授权范围", async () => {
    const { service, calls } = harness();
    expect(await service.list(admin)).toEqual({
      users: [
        {
          id: "u1",
          email: "analyst@example.com",
          name: "Analyst",
          role: "user",
          access_scope: { kind: "limited", values: ["North"] },
          banned: false,
        },
      ],
    });
    await service.create(admin, {
      email: "new@example.com",
      password: "password123",
      role: "user",
      access_scope: { kind: "limited", values: [" North ", "North", "West, D.C."] },
    });
    expect(calls).toEqual([
      {
        create: {
          email: "new@example.com",
          password: "password123",
          name: "new",
          role: "user",
          accessScope: { kind: "limited", values: ["North", "West, D.C."] },
        },
      },
    ]);
  });

  test("角色与授权范围一起更新，管理员不能降低自己的角色", async () => {
    const { service, calls, accounts } = harness();
    await service.updateAuthorization(admin, " u1 ", {
      role: "admin",
      access_scope: { kind: "limited", values: ["North"] },
    });
    expect(calls).toEqual([
      {
        updateAuthorization: {
          userId: "u1",
          role: "admin",
          accessScope: { kind: "limited", values: ["North"] },
        },
      },
    ]);

    accounts.get = async () => account({ email: admin.email, role: "admin" });
    await expect(
      service.updateAuthorization(admin, "u1", {
        role: "user",
        access_scope: { kind: "all" },
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
  });

  test("非管理员请求和无效输入在调用账号端口前被拒绝", async () => {
    const { service } = harness();
    await expect(service.list(user)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.resetPassword(admin, "u1", { password: "short" })).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
  });

  test("账号端口的请求错误转为 400，其他故障转为 503 并使用通用消息", async () => {
    const { service, accounts } = harness();
    accounts.list = async () => {
      throw new UserAccountRequestError("无法读取用户目录");
    };
    await expect(service.list(admin)).rejects.toMatchObject({
      name: "ApplicationError",
      code: "invalid_request",
      message: "无法读取用户目录",
    } satisfies Partial<InvalidRequestError>);

    accounts.list = async () => {
      throw new Error("database path and raw provider detail");
    };
    await expect(service.list(admin)).rejects.toMatchObject({
      name: "ApplicationError",
      code: "unavailable",
      message: "用户管理暂时不可用，请稍后重试",
    } satisfies Partial<UnavailableError>);
  });
});
