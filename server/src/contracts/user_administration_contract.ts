import { z } from "zod";
import { ACCESS_SCOPE_SCHEMA, type AccessScope } from "./access_scope.js";

export const ACCESS_ROLE_SCHEMA = z.enum(["user", "admin"]);
export type AccessRole = z.infer<typeof ACCESS_ROLE_SCHEMA>;

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: AccessRole;
  access_scope: AccessScope;
  banned: boolean;
};

export const ADMIN_USER_SCHEMA: z.ZodType<AdminUser> = z.strictObject({
  id: z.string().trim().min(1),
  email: z.email(),
  name: z.string(),
  role: ACCESS_ROLE_SCHEMA,
  access_scope: ACCESS_SCOPE_SCHEMA,
  banned: z.boolean(),
});

export const ADMIN_USERS_PAYLOAD_SCHEMA = z.strictObject({ users: z.array(ADMIN_USER_SCHEMA) });
export type AdminUsersPayload = z.infer<typeof ADMIN_USERS_PAYLOAD_SCHEMA>;

export const CREATE_ADMIN_USER_BODY = z.strictObject({
  email: z.string().trim().email(),
  password: z.string().min(8),
  name: z.string().trim().optional(),
  role: ACCESS_ROLE_SCHEMA,
  access_scope: ACCESS_SCOPE_SCHEMA,
});
export type CreateAdminUserBody = z.infer<typeof CREATE_ADMIN_USER_BODY>;

export const UPDATE_USER_AUTHORIZATION_BODY = z.strictObject({
  role: ACCESS_ROLE_SCHEMA,
  access_scope: ACCESS_SCOPE_SCHEMA,
});
export type UpdateUserAuthorizationBody = z.infer<typeof UPDATE_USER_AUTHORIZATION_BODY>;

export const RESET_USER_PASSWORD_BODY = z.strictObject({ password: z.string().min(8) });
export type ResetUserPasswordBody = z.infer<typeof RESET_USER_PASSWORD_BODY>;
