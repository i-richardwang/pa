import { expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { ApiError, parseJsonResponse, postJson } from "./api";

const PAYLOAD = z.strictObject({ value: z.string() });

test("Dashboard API 成功响应按 schema 校验，不符合时报 502", async () => {
  await expect(
    parseJsonResponse(
      new Response(JSON.stringify({ value: "ok" }), {
        headers: { "Content-Type": "application/json" },
      }),
      PAYLOAD,
    ),
  ).resolves.toEqual({ value: "ok" });

  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(
      parseJsonResponse(
        new Response(JSON.stringify({ value: 3 }), {
          headers: { "Content-Type": "application/json" },
        }),
        PAYLOAD,
      ),
    ).rejects.toMatchObject({ status: 502, message: "服务端返回的数据格式异常，请刷新后重试" });
  } finally {
    log.mockRestore();
  }
});

test("Dashboard API 错误响应保留服务端错误文案，非 JSON 响应报无法解析", async () => {
  await expect(
    parseJsonResponse(
      new Response(
        JSON.stringify({
          error: {
            code: "conflict",
            message: "报告已更新",
            details: { expected_revision: 2 },
          },
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        },
      ),
      PAYLOAD,
    ),
  ).rejects.toEqual(new ApiError(409, "报告已更新", "conflict", { expected_revision: 2 }));

  await expect(
    parseJsonResponse(new Response("bad gateway", { status: 502 }), PAYLOAD),
  ).rejects.toMatchObject({ status: 502, message: "服务器返回的内容无法解析（502）" });
});

test("可取消请求把 AbortSignal 传到 fetch 边界", async () => {
  const controller = new AbortController();
  let received: AbortSignal | null | undefined;
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => {
    received = init?.signal;
    return new Response(JSON.stringify({ value: "ok" }));
  }) as typeof fetch);
  try {
    await expect(
      postJson("/dashboard/api/example", {}, PAYLOAD, { signal: controller.signal }),
    ).resolves.toEqual({ value: "ok" });
    expect(received).toBe(controller.signal);
  } finally {
    fetchMock.mockRestore();
  }
});
