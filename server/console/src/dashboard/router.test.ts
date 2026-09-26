import { expect, test } from "bun:test";
import {
  analysisHash,
  analysisNewHash,
  boardHash,
  parseRoute,
  reportsHash,
  settingsHash,
  usageHash,
} from "./router";

test("*Hash() 生成的 hash 经 parseRoute 解析回对应路由", () => {
  expect(parseRoute(reportsHash())).toEqual({ page: "reports", facet: "reports" });
  expect(parseRoute(reportsHash("history"))).toEqual({ page: "reports", facet: "history" });
  expect(parseRoute(reportsHash("archived"))).toEqual({ page: "reports", facet: "archived" });
  expect(parseRoute(usageHash("stats"))).toEqual({ page: "usage", facet: "stats" });
  expect(parseRoute(analysisHash("v1"))).toEqual({ page: "analysis", id: "v1" });
  expect(parseRoute(analysisNewHash())).toEqual({ page: "analysis_new" });
  expect(parseRoute(settingsHash())).toEqual({ page: "settings", tab: "account" });
  expect(parseRoute(settingsHash("users"))).toEqual({ page: "settings", tab: "users" });
});

test("看板 ?t= 解析为看板级时间覆盖，无法解析时忽略", () => {
  const time = { window: { kind: "trailing", count: 12, unit: "month", grain: "month" } } as const;
  const parsed = parseRoute(boardHash("b1", time));
  expect(parsed.page).toBe("board");
  expect(parsed.page === "board" && parsed.time).toEqual(time);
  expect(parseRoute("#/board/b1?t=%7Bnot-json")).toEqual({ page: "board", id: "b1" });
  expect(parseRoute(boardHash("b1"))).toEqual({ page: "board", id: "b1" });
});

test("指标、维度、术语三页各有自己的 hash 段", () => {
  expect(parseRoute("#/metrics")).toEqual({ page: "metrics" });
  expect(parseRoute("#/dimensions")).toEqual({ page: "dimensions" });
  expect(parseRoute("#/terms")).toEqual({ page: "terms" });
});

test("空 hash 和未知路径解析为报告列表", () => {
  expect(parseRoute("")).toEqual({ page: "reports", facet: "reports" });
  expect(parseRoute("#/")).toEqual({ page: "reports", facet: "reports" });
  expect(parseRoute("#/nowhere")).toEqual({ page: "reports", facet: "reports" });
});
