/** 数据能力缺口反馈：入参校验、聚合键、持久化与审核状态。 */
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFeedbackStore,
  type FeedbackInput,
  feedbackTopicKey,
  normalizeFeedbackInput,
} from "./feedback.js";
import { createTestAppDatabase } from "../test_support/app_database.js";

let seq = 0;
function freshPath() {
  seq += 1;
  return join(tmpdir(), `pa_feedback_test_${randomUUID()}_${seq}.db`);
}

describe("feedback input", () => {
  test("要求问题原文与缺口解释，两者都去空白", () => {
    expect(
      normalizeFeedbackInput({
        ask: " 能否看加班时长？ ",
        detail: " 当前目录没有加班指标 ",
      }),
    ).toEqual({ ask: "能否看加班时长？", detail: "当前目录没有加班指标" });
    // 越过类型层的运行时护栏：MCP 入参在协议边界仍可能缺 detail
    expect(() => normalizeFeedbackInput({ ask: "问题" } as FeedbackInput)).toThrow("detail");
    expect(() => normalizeFeedbackInput({ ask: " ", detail: "缺口" })).toThrow("ask");
  });

  test("topic_key 按缺口解释归一空白、大小写与全半角，同缺口可聚合", () => {
    const a = normalizeFeedbackInput({ ask: "A", detail: " 缺少 OT  指标 " });
    const b = normalizeFeedbackInput({ ask: "B", detail: "缺少　ｏｔ 指标" });
    expect(feedbackTopicKey(a)).toBe(feedbackTopicKey(b));
    expect(feedbackTopicKey(a)).not.toBe(
      feedbackTopicKey(normalizeFeedbackInput({ ask: "C", detail: "缺少司龄维度" })),
    );
  });
});

describe("feedback store", () => {
  test("每次原话逐行保留，列表按 topic 聚合", async () => {
    const store = createFeedbackStore(createTestAppDatabase(freshPath()));
    const input = { ask: "能看工时吗", detail: "缺工时指标" };
    const first = await store.create(input, "alice@x");
    const second = await store.create({ ...input, ask: "想看团队工时" }, "bob@x");
    expect(second.topic_key).toBe(first.topic_key);

    const page = await store.list();
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({
      ask: "想看团队工时",
      detail: "缺工时指标",
      occurrences: 2,
      callers: ["alice@x", "bob@x"],
      status: "open",
    });
  });

  test("审核按 topic 更新全部历史行；新一次同主题提报会重新打开", async () => {
    const store = createFeedbackStore(createTestAppDatabase(freshPath()));
    const input = { ask: "能看工时吗", detail: "缺工时指标" };
    const created = await store.create(input, "alice@x");
    await store.create({ ...input, ask: "想看团队工时" }, "bob@x");
    const resolved = await store.resolve(
      created.topic_key,
      "accepted",
      "纳入下一版指标目录",
      "admin@x",
    );
    expect(resolved).toMatchObject({
      status: "accepted",
      note: "纳入下一版指标目录",
      resolved_by: "admin@x",
      occurrences: 2,
    });
    await store.create(input, "carol@x");
    expect((await store.list()).rows[0]).toMatchObject({ status: "open", occurrences: 3 });
    expect(
      await store.resolve("00000000000000000000", "rejected", "不在范围", "admin@x"),
    ).toBeNull();
  });
});
