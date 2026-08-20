import type { Principal } from "../contracts/principal.js";
import {
  CREATE_ADMIN_USER_BODY,
  RESET_USER_PASSWORD_BODY,
  UPDATE_USER_AUTHORIZATION_BODY,
  type AdminUser,
  type AdminUsersPayload,
  type CreateAdminUserBody,
  type ResetUserPasswordBody,
  type UpdateUserAuthorizationBody,
} from "../contracts/user_administration_contract.js";
import type {
  UserAccount,
  UserAccountAdministration,
} from "../ports/user_account_administration.js";
import { UserAccountRequestError } from "../ports/user_account_administration.js";
import { ForbiddenError, InvalidRequestError, UnavailableError } from "./errors.js";

const requireAdmin = (principal: Principal) => {
  if (!principal.roles.includes("admin")) throw new ForbiddenError("需要管理员权限");
};

const project = (account: UserAccount): AdminUser => ({
  id: account.id,
  email: account.email,
  name: account.name,
  role: account.role,
  access_scope: account.accessScope,
  banned: account.banned,
});

const accountFailure = (error: unknown): InvalidRequestError | UnavailableError =>
  error instanceof UserAccountRequestError
    ? new InvalidRequestError(error.message)
    : new UnavailableError("用户管理暂时不可用，请稍后重试", error);

export function createUserAdministrationService(deps: { accounts: UserAccountAdministration }) {
  return {
    async list(principal: Principal): Promise<AdminUsersPayload> {
      requireAdmin(principal);
      try {
        return { users: (await deps.accounts.list()).map(project) };
      } catch (error) {
        throw accountFailure(error);
      }
    },

    async create(principal: Principal, input: CreateAdminUserBody): Promise<AdminUser> {
      requireAdmin(principal);
      const parsed = CREATE_ADMIN_USER_BODY.safeParse(input);
      if (!parsed.success) throw new InvalidRequestError("用户信息不完整或格式无效");
      try {
        const { access_scope: accessScope, name, ...account } = parsed.data;
        return project(
          await deps.accounts.create({
            ...account,
            name: name || parsed.data.email.split("@")[0] || parsed.data.email,
            accessScope,
          }),
        );
      } catch (error) {
        throw accountFailure(error);
      }
    },

    async updateAuthorization(
      principal: Principal,
      userId: string,
      input: UpdateUserAuthorizationBody,
    ): Promise<AdminUser> {
      requireAdmin(principal);
      const id = userId.trim();
      const parsed = UPDATE_USER_AUTHORIZATION_BODY.safeParse(input);
      if (!id || !parsed.success) throw new InvalidRequestError("用户权限格式无效");
      try {
        const current = await deps.accounts.get(id);
        if (
          current.email.toLowerCase() === principal.email.toLowerCase() &&
          current.role !== parsed.data.role
        ) {
          throw new InvalidRequestError("不能修改自己的角色，请让另一位管理员操作");
        }
        return project(
          await deps.accounts.updateAuthorization(id, {
            role: parsed.data.role,
            accessScope: parsed.data.access_scope,
          }),
        );
      } catch (error) {
        if (error instanceof InvalidRequestError) throw error;
        throw accountFailure(error);
      }
    },

    async resetPassword(
      principal: Principal,
      userId: string,
      input: ResetUserPasswordBody,
    ): Promise<void> {
      requireAdmin(principal);
      const id = userId.trim();
      const parsed = RESET_USER_PASSWORD_BODY.safeParse(input);
      if (!id || !parsed.success) throw new InvalidRequestError("密码至少需要 8 位");
      try {
        await deps.accounts.resetPassword(id, parsed.data.password);
      } catch (error) {
        throw accountFailure(error);
      }
    },
  };
}

export type UserAdministrationService = ReturnType<typeof createUserAdministrationService>;
