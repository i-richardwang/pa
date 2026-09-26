import {
  parseStoredAccessScope,
  type AccessScope,
  type AccessScopeDefinition,
} from "./access_scope.js";

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

/** 把 Better Auth 用户字段解析为 Principal；role 字段是逗号分隔的多个角色。 */
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
