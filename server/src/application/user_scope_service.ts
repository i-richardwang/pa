import { SET_ORG_SCOPE_BODY, type SetOrgScopeBody } from "../contracts/session_contract.js";
import type { Principal } from "../contracts/principal.js";
import type { UserScopeWriter } from "../ports/user_scope_writer.js";
import { ForbiddenError, InvalidRequestError } from "./errors.js";

export function createUserScopeService(deps: { writer: UserScopeWriter }) {
  async function setOrgScope(principal: Principal, input: SetOrgScopeBody): Promise<void> {
    if (!principal.roles.includes("admin")) throw new ForbiddenError("需要管理员权限");
    const parsed = SET_ORG_SCOPE_BODY.safeParse(input);
    if (!parsed.success) throw new InvalidRequestError("缺少 userId 或 org_scope");
    await deps.writer.setOrgScope(parsed.data.userId, parsed.data.org_scope.trim());
  }

  return { setOrgScope };
}

export type UserScopeService = ReturnType<typeof createUserScopeService>;
