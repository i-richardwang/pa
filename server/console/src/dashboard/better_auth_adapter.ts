import type { authClient } from "../auth_client";

export const ACCESS_ROLE_VALUES = ["user", "admin"] as const;
export type AccessRole = (typeof ACCESS_ROLE_VALUES)[number];

type BetterAuthAdminRole = Parameters<typeof authClient.admin.setRole>[0]["role"];

export function parseAccessRole(value: unknown): AccessRole {
  if (typeof value === "string" && ACCESS_ROLE_VALUES.includes(value as AccessRole)) {
    return value as AccessRole;
  }
  throw new Error(`未知数据角色：${String(value)}`);
}

export function toBetterAuthAdminRole(role: AccessRole): BetterAuthAdminRole {
  return role as BetterAuthAdminRole;
}

export function authErrorText(error: { message?: string } | null | undefined): string | null {
  return error ? (error.message ?? "操作失败") : null;
}
