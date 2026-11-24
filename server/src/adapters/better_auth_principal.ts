import { z } from "zod";
import type { AccessScopeDefinition } from "../contracts/access_scope.js";
import { principalFromAttributes, type Principal } from "../contracts/principal.js";

type BetterAuthUserLookup = {
  findUserById(userId: string): Promise<unknown>;
};

const STORED_USER_SCHEMA = z.object({
  email: z.string(),
  role: z.string().nullish(),
  banned: z.boolean().nullish(),
  banExpires: z.coerce.date().nullish(),
  access_scope: z.string().nullish(),
});

/** MCP 凭证绑定账号；封禁、角色和数据范围按本次请求的账号状态生效。 */
export async function resolveBetterAuthPrincipal(
  users: BetterAuthUserLookup,
  userId: string,
  accessScope: AccessScopeDefinition,
): Promise<Principal | null> {
  const found = await users.findUserById(userId);
  if (found === null) return null;
  const user = STORED_USER_SCHEMA.parse(found);
  if (user.banned && (!user.banExpires || user.banExpires.getTime() >= Date.now())) return null;
  return principalFromAttributes(user, accessScope);
}
