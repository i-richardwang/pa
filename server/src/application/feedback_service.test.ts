import { expect, test } from "bun:test";
import type { FeedbackRepository } from "../ports/feedback_repository.js";
import { createFeedbackService } from "./feedback_service.js";
import { ForbiddenError, InvalidRequestError } from "./errors.js";

test("Feedback Application 一次完成输入、审核说明与分页规范化", async () => {
  const calls: unknown[] = [];
  const repository = {
    create: async (input, caller) => {
      calls.push({ kind: "create", input, caller });
      return {
        id: 1,
        at: "2026-08-20T00:00:00.000Z",
        caller,
        status: "open" as const,
        note: null,
        resolved_by: null,
        resolved_at: null,
        topic_key: "0123456789abcdef0123",
        ...input,
      };
    },
    list: async (limit, offset) => {
      calls.push({ kind: "list", limit, offset });
      return { rows: [], total: 0 };
    },
    resolve: async (_topicKey, _status, note) => {
      calls.push({ kind: "resolve", note });
      return null;
    },
  } satisfies FeedbackRepository;
  const service = createFeedbackService({ repository, usage: { log: async () => {} } });
  const admin = {
    email: "admin@x",
    roles: ["admin" as const],
    accessScope: { kind: "all" } as const,
  };
  const user = { email: "user@x", roles: ["user" as const], accessScope: { kind: "all" } as const };

  await service.submit(
    { email: "user@x", roles: ["user"], accessScope: { kind: "all" } },
    { ask: " 能看工时吗？ ", detail: " 缺少工时指标 " },
  );
  await service.list(admin, Number.POSITIVE_INFINITY, -2);
  await service.resolve(admin, "0123456789abcdef0123", "accepted", " 已纳入规划 ");
  await expect(service.resolve(admin, "invalid", "rejected", " 不处理 ")).rejects.toBeInstanceOf(
    InvalidRequestError,
  );
  await expect(service.list(user)).rejects.toBeInstanceOf(ForbiddenError);

  expect(calls).toEqual([
    {
      kind: "create",
      input: { ask: "能看工时吗？", detail: "缺少工时指标" },
      caller: "user@x",
    },
    { kind: "list", limit: 20, offset: 0 },
    { kind: "resolve", note: "已纳入规划" },
  ]);
});
