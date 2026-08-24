import { z } from "zod";
import type { AccessScopeDefinition } from "../contracts/access_scope.js";
import { principalFromAttributes, type Principal } from "../contracts/principal.js";

type BetterAuthUserLookup = {
  findUserById(userId: string): Promise<unknown>;
};

const STORED_USER_SCHEMA = z.object({
  email: z.string(),
  role: z.string().nullish(),
  access_scope: z.string().nullish(),
});

/** token 只带 user id；实时回查当前角色与数据范围，查询失败不得伪装成空权限用户。 */
export async function resolveBetterAuthPrincipal(
  users: BetterAuthUserLookup,
  userId: string,
  accessScope: AccessScopeDefinition,
): Promise<Principal> {
  const found = await users.findUserById(userId);
  const user = found === null ? null : STORED_USER_SCHEMA.parse(found);
  return principalFromAttributes(
    {
      email: user?.email ?? userId,
      role: user?.role,
      access_scope: user?.access_scope,
    },
    accessScope,
  );
}
