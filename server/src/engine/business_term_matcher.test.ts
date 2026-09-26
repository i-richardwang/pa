import { describe, expect, test } from "bun:test";
import { matchBusinessTerms, normalizeBusinessTerm } from "./business_term_matcher.js";

const terms = [
  { id: "band_c", canonical_term: "Band C+", aliases: ["Band C及以上"] },
  { id: "org", canonical_term: "公司一级组织", aliases: ["组织"] },
  { id: "org_tree", canonical_term: "部门组织树", aliases: ["组织"] },
  { id: "one", canonical_term: "研", aliases: [] },
];

describe("business term matcher", () => {
  test("规范化全半角、大小写与空白，保留业务符号", () => {
    expect(normalizeBusinessTerm(" Ｂａｎｄ Ｃ+  ")).toBe("band c+");
    expect(normalizeBusinessTerm("Band C")).not.toBe(normalizeBusinessTerm("Band C+"));
  });

  test("精确匹配优先；输入只是标签的一部分时不匹配", () => {
    expect(matchBusinessTerms(["Band C+"], terms)).toEqual([
      { input_term: "Band C+", status: "resolved", term_ids: ["band_c"] },
    ]);
    expect(matchBusinessTerms(["Band C"], terms)).toEqual([]);
  });

  test("整句输入匹配其中最长的完整标签", () => {
    expect(matchBusinessTerms(["请看Band C及以上的离职率"], terms)[0]).toEqual({
      input_term: "请看Band C及以上的离职率",
      status: "resolved",
      term_ids: ["band_c"],
    });
  });

  test("同一叫法对应多个术语时返回 ambiguous", () => {
    expect(matchBusinessTerms(["组织"], terms)[0]).toEqual({
      input_term: "组织",
      status: "ambiguous",
      term_ids: ["org", "org_tree"],
    });
  });

  test("单字标签只允许精确匹配", () => {
    expect(matchBusinessTerms(["研"], terms)[0]?.term_ids).toEqual(["one"]);
    expect(matchBusinessTerms(["研发"], terms)).toEqual([]);
  });
});
