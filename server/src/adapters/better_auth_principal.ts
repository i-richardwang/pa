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

/** token 只含 user id，每次回查当前角色与数据范围；查询出错时抛出异常，不按无权限用户处理。 */
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
