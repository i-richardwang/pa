import { describe, expect, test } from "bun:test";
import { normalizeCatalogQuery, normalizeCatalogTerms } from "./catalog_query.js";

describe("normalizeCatalogTerms", () => {
  test("去空白并大小写不敏感去重，保留首次写法", () => {
    expect(normalizeCatalogTerms([" 离职率 ", "YTD", "ytd", "组织"])).toEqual([
      "离职率",
      "YTD",
      "组织",
    ]);
  });

  test("数组项内部空格保持为一个完整术语", () => {
    expect(normalizeCatalogTerms(["unmatched phrase", "组织"])).toEqual([
      "unmatched phrase",
      "组织",
    ]);
  });

  test("全部为空白的数组被拒绝", () => {
    expect(() => normalizeCatalogTerms([" ", ""])).toThrow("至少提供一个");
  });
});

describe("normalizeCatalogQuery", () => {
  test("空入参返回目录概览", () => {
    expect(normalizeCatalogQuery({})).toEqual({ mode: "overview" });
  });

  test("terms 按数组项检索，不切分项内空格", () => {
    expect(normalizeCatalogQuery({ terms: ["unmatched phrase", "组织"] })).toEqual({
      mode: "search",
      terms: ["unmatched phrase", "组织"],
    });
  });
});
