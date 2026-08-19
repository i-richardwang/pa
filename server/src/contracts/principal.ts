/** 已认证调用者及其产品授权属性。 */
export type Principal = {
  email: string;
  roles: string[];
  orgScope: "*" | string[];
};

export type PrincipalAttributes = {
  email: string;
  role?: string | null;
  org_scope?: string | null;
};

/** Better Auth 持久化字段到产品身份的唯一解析边界。 */
export function principalFromAttributes(attributes: PrincipalAttributes): Principal {
  const roles = String(attributes.role ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  const rawScope = String(attributes.org_scope ?? "");
  const orgScope: Principal["orgScope"] =
    rawScope === "*"
      ? "*"
      : rawScope
          .split(",")
          .map((scope) => scope.trim())
          .filter(Boolean);
  return { email: attributes.email, roles, orgScope };
}
