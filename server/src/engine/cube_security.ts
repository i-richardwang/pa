/**
 * 应用查询只把已认证主体映射为 Cube securityContext；成员与行权限由 view.access_policy
 * 唯一执行。这里不读取模型、不改写查询，也不复刻 Cube 的授权判断。
 */
import type { CubeSecurityContext } from "../ports/cube_gateway.js";
import type { Principal } from "../contracts/principal.js";

export const CUBE_ACCESS_GROUP = {
  full: "pa_full",
  scoped: "pa_scoped",
  service: "pa_service",
} as const;

const DATA_ROLES = new Set(["user", "admin"]);

/** 身份属性本身无有效授权时的产品级错误；数据授权拒绝仍由 Cube 返回。 */
export class AuthzError extends Error {}

/**
 * 当前角色在列权限上等价，故只按数据范围映射到一个策略组。
 * 未知角色、空数据范围不签发任何可访问数据的上下文，先给调用者明确错误。
 */
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

/** freshness 等非用户请求使用独立服务身份，不能借用任一调用者的数据范围。 */
export const SERVICE_CUBE_CONTEXT: CubeSecurityContext = {
  subject: "pa-service",
  groups: [CUBE_ACCESS_GROUP.service],
  accessScope: { kind: "all" },
};
