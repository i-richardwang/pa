/** /dashboard/api 取数：未登录统一回登录页（带回跳），报错透出服务端 error 文案 */
import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
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

const errorMessage = (value: unknown): string | null => {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  return typeof value.error === "string" && value.error ? value.error : null;
};

export async function parseJsonResponse<T>(res: Response, schema: JsonSchema<T>): Promise<T> {
  if (res.status === 401) {
    window.location.assign("/login?redirect=/dashboard");
    throw new ApiError(401, "未登录");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.ok ? 502 : res.status, `服务端返回无法解析（${res.status}）`);
  }
  if (!res.ok) {
    throw new ApiError(res.status, errorMessage(body) ?? `请求失败（${res.status}）`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error("[pa] Dashboard API 响应不符合契约", parsed.error.issues);
    throw new ApiError(502, "服务端返回的数据格式异常，请刷新后重试");
  }
  return parsed.data;
}

const request = parseJsonResponse;

/**
 * 控制台时间戳的唯一拼法：本地时区、年月日时分、数字等宽。
 * 年带上是因为同一张表里既有上周的记录也有一年后的到期日；没有值印一道破折号。
 */
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
