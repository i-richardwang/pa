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
  test("未达到上限时，结果完整且没有提示", () => {
    const r = resolveLimitOutcome(3, 200);
    expect(r).toEqual({ rowCount: 3, hasMore: false });
  });

  test("行数恰好等于上限时，不误报还有更多行", () => {
    const r = resolveLimitOutcome(200, 200);
    expect(r).toEqual({ rowCount: 200, hasMore: false });
  });

  test("达到返回上限时，truncated 提示下载或缩小查询", () => {
    const r = resolveLimitOutcome(2001, 2000);
    expect(r.rowCount).toBe(2000);
    expect(r.hasMore).toBe(true);
    expect(r.truncated).toContain("导出链接");
    expect(r.truncated).toContain("2000");
  });
});

describe("聚合结果的两级上限：卡片显示全部行，模型只收到前几行样本", () => {
  test("模型样本的行数上限低于卡片显示上限", () => {
    expect(AGGREGATE_MODEL_ROWS).toBeLessThan(AGGREGATE_CARD_ROWS);
  });

  test("样本说明提示以 row_count 为准，不要把样本内的合计当总量", () => {
    const note = modelSampleNote(1500);
    expect(note).toContain("1500");
    expect(note).toContain(`前 ${AGGREGATE_MODEL_ROWS} 行样本`);
    expect(note).toContain("row_count");
  });
});

describe("isBoundedResultComplete：有行数上限的执行是否完整", () => {
  test("导出未达到引擎行数上限时，结果完整", () => {
    expect(isBoundedResultComplete(12345, 50000)).toBe(true);
  });

  test("导出达到引擎行数上限时，无法确认结果是否完整", () => {
    expect(isBoundedResultComplete(50000, 50000)).toBe(false);
  });
});
