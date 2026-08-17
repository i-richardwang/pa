/**
 * 业务术语的公共与管理契约。术语只解释业务语言；可选成员关联用于目录导航，
 * 不携带过滤器、数据值、SQL 或其他可执行查询片段。
 */
import { z } from "zod";

export const BUSINESS_TERM_LIMITS = {
  canonical_term: 100,
  definition: 500,
  context: 200,
  alias: 100,
  aliases: 20,
  related_members: 20,
} as const;

const CLEAN_TEXT = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label}不能为空`)
    .max(max, `${label}不能超过 ${max} 个字符`)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 业务术语会进入 Agent 上下文
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), `${label}不能含换行或控制字符`);

const CLEAN_MULTILINE_TEXT = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label}不能为空`)
    .max(max, `${label}不能超过 ${max} 个字符`)
    .refine(
      (value) =>
        [...value].every((character) => {
          const code = character.charCodeAt(0);
          return code === 10 || code === 13 || (code >= 32 && code !== 127);
        }),
      `${label}不能含控制字符`,
    );

const ALIASES_INPUT = z
  .array(CLEAN_TEXT("其他叫法", BUSINESS_TERM_LIMITS.alias))
  .max(BUSINESS_TERM_LIMITS.aliases)
  .default([]);

const RELATED_MEMBER_IDS_INPUT = z
  .array(z.string().trim().min(1).max(200))
  .max(BUSINESS_TERM_LIMITS.related_members)
  .default([]);

export const BUSINESS_TERM_CONTENT_INPUT = z
  .object({
    canonical_term: CLEAN_TEXT("规范术语", BUSINESS_TERM_LIMITS.canonical_term),
    definition: CLEAN_MULTILINE_TEXT("术语定义", BUSINESS_TERM_LIMITS.definition),
    context: CLEAN_TEXT("适用语境", BUSINESS_TERM_LIMITS.context).optional(),
    aliases: ALIASES_INPUT,
    related_member_ids: RELATED_MEMBER_IDS_INPUT,
  })
  .strict();
export type BusinessTermContentInput = z.infer<typeof BUSINESS_TERM_CONTENT_INPUT>;

export const CREATE_BUSINESS_TERM_BODY = BUSINESS_TERM_CONTENT_INPUT;
export type CreateBusinessTermBody = z.infer<typeof CREATE_BUSINESS_TERM_BODY>;

export const UPDATE_BUSINESS_TERM_BODY = BUSINESS_TERM_CONTENT_INPUT;
export type UpdateBusinessTermBody = z.infer<typeof UPDATE_BUSINESS_TERM_BODY>;

export type BusinessTermRelatedMember = {
  id: string;
  title: string | null;
  kind: "measure" | "dimension" | null;
  status: "available" | "missing";
};

export type PublicBusinessTerm = {
  id: string;
  canonical_term: string;
  definition: string;
  context?: string;
  aliases: string[];
  related_members: BusinessTermRelatedMember[];
};

export type BusinessTermsPayload = { rows: PublicBusinessTerm[] };

export type BusinessTermResolutionMatch = PublicBusinessTerm;
export type BusinessTermResolution = {
  input_term: string;
  status: "resolved" | "ambiguous";
  matches: BusinessTermResolutionMatch[];
};

const RELATED_MEMBER_SCHEMA: z.ZodType<BusinessTermRelatedMember> = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    kind: z.enum(["measure", "dimension"]).nullable(),
    status: z.enum(["available", "missing"]),
  })
  .strict();

export const BUSINESS_TERM_SCHEMA = z
  .object({
    id: z.string().uuid(),
    canonical_term: z.string(),
    definition: z.string(),
    context: z.string().optional(),
    aliases: z.array(z.string()),
    related_members: z.array(RELATED_MEMBER_SCHEMA),
  })
  .strict();

export const BUSINESS_TERMS_PAYLOAD_SCHEMA: z.ZodType<BusinessTermsPayload> = z
  .object({ rows: z.array(BUSINESS_TERM_SCHEMA) })
  .strict();

export const BUSINESS_TERM_RESOLUTION_SCHEMA: z.ZodType<BusinessTermResolution> = z
  .object({
    input_term: z.string(),
    status: z.enum(["resolved", "ambiguous"]),
    matches: z.array(BUSINESS_TERM_SCHEMA).min(1),
  })
  .strict();
