import type { AccessScopeDefinition } from "../contracts/access_scope.js";
import { principalFromAttributes, type Principal } from "../contracts/principal.js";

type BetterAuthUserLookup = {
  findUserById(userId: string): Promise<unknown>;
};

type StoredUserAttributes = {
  email: string;
  role?: string | null;
  access_scope?: string | null;
};

function storedUser(value: unknown): StoredUserAttributes | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("认证用户资料格式异常");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.email !== "string" ||
    (record.role !== undefined && record.role !== null && typeof record.role !== "string") ||
    (record.access_scope !== undefined &&
      record.access_scope !== null &&
      typeof record.access_scope !== "string")
  ) {
    throw new Error("认证用户资料格式异常");
  }
  return {
    email: record.email,
    role: record.role as string | null | undefined,
    access_scope: record.access_scope as string | null | undefined,
  };
}

/** token 只带 user id；实时回查当前角色与数据范围，查询失败不得伪装成空权限用户。 */
export async function resolveBetterAuthPrincipal(
  users: BetterAuthUserLookup,
  userId: string,
  accessScope: AccessScopeDefinition,
): Promise<Principal> {
  const user = storedUser(await users.findUserById(userId));
  return principalFromAttributes(
    {
      email: user?.email ?? userId,
      role: user?.role,
      access_scope: user?.access_scope,
    },
    accessScope,
  );
}
