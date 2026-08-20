import {
  parseStoredAccessScope,
  type AccessScope,
  type AccessScopeDefinition,
} from "./access_scope.js";

/** 已认证调用者及其产品授权属性。 */
export type Principal = {
  email: string;
  roles: string[];
  accessScope: AccessScope;
};

export type PrincipalAttributes = {
  email: string;
  role?: string | null;
  access_scope?: string | null;
};

/** Better Auth 持久化字段到产品身份的唯一解析边界。 */
export function principalFromAttributes(
  attributes: PrincipalAttributes,
  accessScope: AccessScopeDefinition,
): Principal {
  const roles = String(attributes.role ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  return {
    email: attributes.email,
    roles,
    accessScope: parseStoredAccessScope(attributes.access_scope, accessScope.id),
  };
}
