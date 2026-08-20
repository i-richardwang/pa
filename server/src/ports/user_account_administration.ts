import type { AccessScope } from "../contracts/access_scope.js";
import type { AccessRole } from "../contracts/user_administration_contract.js";

export class UserAccountRequestError extends Error {
  override name = "UserAccountRequestError";
}

export type UserAccount = {
  id: string;
  email: string;
  name: string;
  role: AccessRole;
  accessScope: AccessScope;
  banned: boolean;
};

export type UserAccountAdministration = {
  list(): Promise<UserAccount[]>;
  get(userId: string): Promise<UserAccount>;
  create(input: {
    email: string;
    password: string;
    name: string;
    role: AccessRole;
    accessScope: AccessScope;
  }): Promise<UserAccount>;
  updateAuthorization(
    userId: string,
    input: { role: AccessRole; accessScope: AccessScope },
  ): Promise<UserAccount>;
  resetPassword(userId: string, password: string): Promise<void>;
};
