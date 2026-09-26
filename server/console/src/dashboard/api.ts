import type { z } from "zod";
import { PUBLIC_ERROR_RESPONSE_SCHEMA, type PublicErrorCode } from "@contracts/error_contract";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: PublicErrorCode,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type JsonSchema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

export async function getJson<T>(path: string, schema: JsonSchema<T>): Promise<T> {
  return request(await fetch(path, { headers: { Accept: "application/json" } }), schema);
}

export async function postJson<T>(
  path: string,
  body: unknown,
  schema: JsonSchema<T>,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  return sendJson("POST", path, schema, body, options);
}

export async function patchJson<T>(path: string, body: unknown, schema: JsonSchema<T>): Promise<T> {
  return sendJson("PATCH", path, schema, body);
}

export async function putJson<T>(path: string, body: unknown, schema: JsonSchema<T>): Promise<T> {
  return sendJson("PUT", path, schema, body);
}

export async function deleteJson<T>(path: string, schema: JsonSchema<T>): Promise<T> {
  return sendJson("DELETE", path, schema);
}

async function sendJson<T>(
  method: string,
  path: string,
  schema: JsonSchema<T>,
  body?: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  return request(
    await fetch(path, {
      method,
      signal: options.signal,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    schema,
  );
}

export async function parseJsonResponse<T>(res: Response, schema: JsonSchema<T>): Promise<T> {
  if (res.status === 401) {
    window.location.assign("/login?redirect=/dashboard");
    throw new ApiError(401, "未登录");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.ok ? 502 : res.status, `服务器返回的内容无法解析（${res.status}）`);
  }
  if (!res.ok) {
    const parsedError = PUBLIC_ERROR_RESPONSE_SCHEMA.safeParse(body);
    if (!parsedError.success) throw new ApiError(res.status, `请求失败（${res.status}）`);
    const { code, message, details } = parsedError.data.error;
    throw new ApiError(res.status, message, code, details);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error("[pa] Dashboard API 响应格式与接口定义不符", parsed.error.issues);
    throw new ApiError(502, "服务端返回的数据格式异常，请刷新后重试");
  }
  return parsed.data;
}

const request = parseJsonResponse;

/** 401 已在 parseJsonResponse 里整页跳转登录，不显示为错误。 */
export function errorText(error: unknown): string | null {
  if (!error || (error instanceof ApiError && error.status === 401)) return null;
  return error instanceof Error ? error.message : String(error);
}

/** 控制台所有时间戳都用这个函数格式化。 */
export function formatAt(at: string | Date | null | undefined): string {
  if (!at) return "—";
  return new Date(at).toLocaleString("zh-CN", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
