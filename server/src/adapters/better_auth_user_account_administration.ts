import type { Auth } from "../auth.js";
import {
  parseStoredAccessScope,
  serializeAccessScope,
  type AccessScopeDefinition,
} from "../contracts/access_scope.js";
import { ACCESS_ROLE_SCHEMA } from "../contracts/user_administration_contract.js";
import type {
  UserAccount,
  UserAccountAdministration,
} from "../ports/user_account_administration.js";
import { UserAccountRequestError } from "../ports/user_account_administration.js";

type BetterAuthUser = {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  access_scope?: string | null;
  banned?: boolean | null;
};

const effectiveRole = (role: BetterAuthUser["role"]): "user" | "admin" => {
  const roles = String(role ?? "")
    .split(",")
    .map((item) => item.trim());
  return roles.includes("admin") ? "admin" : "user";
};

async function betterAuthRequest<T>(action: () => Promise<T>, rejectedMessage: string): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? error.statusCode
        : undefined;
    if (typeof statusCode === "number" && statusCode < 500) {
      throw new UserAccountRequestError(rejectedMessage, { cause: error });
    }
    throw error;
  }
}

const userAccount = (user: BetterAuthUser, definition: AccessScopeDefinition): UserAccount => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: ACCESS_ROLE_SCHEMA.parse(effectiveRole(user.role)),
  accessScope: parseStoredAccessScope(user.access_scope, definition.id),
  banned: user.banned === true,
});

/** Better Auth 的用户协议与持久化字段只在此适配器转换为结构化账号合同。 */
export function createBetterAuthUserAccountAdministration(
  auth: Auth,
  definition: AccessScopeDefinition,
  headers?: Headers,
): UserAccountAdministration {
  const request = headers ? { headers } : {};
  return {
    async list() {
      const result = (await betterAuthRequest(
        () =>
          auth.api.listUsers({
            ...request,
            query: { limit: 200, sortBy: "createdAt", sortDirection: "desc" },
          }),
        "无法读取用户目录",
      )) as { users: BetterAuthUser[] };
      return result.users.map((user: unknown) => userAccount(user as BetterAuthUser, definition));
    },
    async get(userId) {
      const user = await betterAuthRequest(
        () => auth.api.getUser({ ...request, query: { id: userId } }),
        "用户不存在或不可访问",
      );
      return userAccount(user as BetterAuthUser, definition);
    },
    async create(input) {
      const result = (await betterAuthRequest(
        () =>
          auth.api.createUser({
            ...request,
            body: {
              email: input.email,
              password: input.password,
              name: input.name,
              role: input.role,
              data: {
                access_scope: serializeAccessScope(input.accessScope, definition.id),
              },
            },
          }),
        "无法创建用户，请确认邮箱尚未被使用",
      )) as { user: BetterAuthUser };
      return userAccount(result.user as BetterAuthUser, definition);
    },
    async updateAuthorization(userId, input) {
      const user = await betterAuthRequest(
        () =>
          auth.api.adminUpdateUser({
            ...request,
            body: {
              userId,
              data: {
                role: input.role,
                access_scope: serializeAccessScope(input.accessScope, definition.id),
              },
            },
          }),
        "无法更新用户权限，请确认用户仍然存在",
      );
      return userAccount(user as BetterAuthUser, definition);
    },
    async resetPassword(userId, password) {
      await betterAuthRequest(
        () => auth.api.setUserPassword({ ...request, body: { userId, newPassword: password } }),
        "无法重置密码，请确认用户仍然存在",
      );
    },
  };
}
