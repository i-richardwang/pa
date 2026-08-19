import { z } from "zod";

export type MePayload = {
  email: string;
  name: string;
  role: string;
  is_admin: boolean;
  /** 行权限：有权组织的 organization_name 清单原值——"*"=全部组织、""=未授权、否则逗号分隔 */
  org_scope: string;
};

export const ME_PAYLOAD_SCHEMA: z.ZodType<MePayload> = z
  .object({
    email: z.string(),
    name: z.string(),
    role: z.string(),
    is_admin: z.boolean(),
    org_scope: z.string(),
  })
  .strict();

export const SET_ORG_SCOPE_BODY = z
  .object({ userId: z.string().trim().min(1), org_scope: z.string() })
  .strict();
export type SetOrgScopeBody = z.infer<typeof SET_ORG_SCOPE_BODY>;
