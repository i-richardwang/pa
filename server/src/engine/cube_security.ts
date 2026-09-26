/** 成员与行权限只由 view.access_policy 执行；这里只把已认证主体映射为 Cube securityContext。 */
import type { CubeSecurityContext } from "../ports/cube_gateway.js";
import type { Principal } from "../contracts/principal.js";

export const CUBE_ACCESS_GROUP = {
  full: "pa_full",
  scoped: "pa_scoped",
  service: "pa_service",
} as const;

/** 有数据访问权的角色；新增角色前先确认 cubeSecurityContext 的策略组映射仍然成立。 */
export const DATA_ROLES = new Set(["user", "admin"]);

/** 账号本身没有有效授权时抛出；数据授权拒绝由 Cube 返回。 */
export class AuthzError extends Error {}

export function cubeSecurityContext(principal: Principal): CubeSecurityContext {
  if (!principal.roles.some((role) => DATA_ROLES.has(role))) {
    throw new AuthzError("当前账号没有数据访问角色，请联系管理员开通");
  }
  if (principal.accessScope.kind === "limited" && principal.accessScope.values.length === 0) {
    throw new AuthzError("尚未获授任何数据范围，请联系管理员开通");
  }
  return {
    subject: principal.email,
    groups: [
      principal.accessScope.kind === "all" ? CUBE_ACCESS_GROUP.full : CUBE_ACCESS_GROUP.scoped,
    ],
    accessScope: principal.accessScope,
  };
}

/** 数据时效查询等非用户请求使用的服务身份，不使用任何调用者的数据范围。 */
export const SERVICE_CUBE_CONTEXT: CubeSecurityContext = {
  subject: "pa-service",
  groups: [CUBE_ACCESS_GROUP.service],
  accessScope: { kind: "all" },
};
