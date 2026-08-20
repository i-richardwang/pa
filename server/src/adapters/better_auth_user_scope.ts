import type { Auth } from "../auth.js";
import type { UserScopeWriter } from "../ports/user_scope_writer.js";

/** Better Auth 用户扩展字段写入器；业务授权与输入规范化由 Application 负责。 */
export function createBetterAuthUserScopeWriter(auth: Auth): UserScopeWriter {
  return {
    async setOrgScope(userId, orgScope) {
      const context = await auth.$context;
      await context.internalAdapter.updateUser(userId, { org_scope: orgScope });
    },
  };
}
