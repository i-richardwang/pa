/**
 * 返回上限语义纯函数单测：服务交付预算的完整性判定，以及聚合两级上限
 * （卡片交付全量 × 模型头部样本）的注记语义。
 */
import { describe, expect, test } from "bun:test";
import {
  AGGREGATE_CARD_ROWS,
  AGGREGATE_MODEL_ROWS,
  isBoundedResultComplete,
  modelSampleNote,
  resolveLimitOutcome,
} from "./result_limit.js";

describe("resolveLimitOutcome：截断判定", () => {
  test("未触上限：完整结果，无告警", () => {
    const r = resolveLimitOutcome(3, 200);
    expect(r).toEqual({ rowCount: 3, hasMore: false });
  });

  test("恰好等于上限：探测负例，不误报还有更多", () => {
    const r = resolveLimitOutcome(200, 200);
    expect(r).toEqual({ rowCount: 200, hasMore: false });
  });

  test("交付预算触顶：truncated 引导下载/重查", () => {
    const r = resolveLimitOutcome(2001, 2000);
    expect(r.rowCount).toBe(2000);
    expect(r.hasMore).toBe(true);
    expect(r.truncated).toContain("导出链接");
    expect(r.truncated).toContain("2000");
  });
});

describe("聚合两级上限：卡片交付全量 × 模型头部样本", () => {
  test("上限序关系：模型样本上限低于卡片交付上限（采样才有意义）", () => {
    expect(AGGREGATE_MODEL_ROWS).toBeLessThan(AGGREGATE_CARD_ROWS);
  });

  test("样本注记：以 row_count 为准，防样本合计当总量", () => {
    const note = modelSampleNote(1500);
    expect(note).toContain("1500");
    expect(note).toContain(`前 ${AGGREGATE_MODEL_ROWS} 行样本`);
    expect(note).toContain("row_count");
  });
});

describe("isBoundedResultComplete：有界执行完整性", () => {
  test("顶格导出未触引擎上限：完整", () => {
    expect(isBoundedResultComplete(12345, 50000)).toBe(true);
  });

  test("顶格导出触引擎上限：完整性不可确认（无法多取探测）", () => {
    expect(isBoundedResultComplete(50000, 50000)).toBe(false);
  });
});
