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

test("各 *Hash() 拼出的串都能被 parseRoute 读回同一路由", () => {
  expect(parseRoute(reportsHash())).toEqual({ page: "reports", facet: "reports" });
  expect(parseRoute(reportsHash("history"))).toEqual({ page: "reports", facet: "history" });
  expect(parseRoute(reportsHash("archived"))).toEqual({ page: "reports", facet: "archived" });
  expect(parseRoute(usageHash("stats"))).toEqual({ page: "usage", facet: "stats" });
  expect(parseRoute(analysisHash("v1"))).toEqual({ page: "analysis", id: "v1" });
  expect(parseRoute(analysisNewHash())).toEqual({ page: "analysis_new" });
  expect(parseRoute(settingsHash())).toEqual({ page: "settings", tab: "account" });
  expect(parseRoute(settingsHash("users"))).toEqual({ page: "settings", tab: "users" });
});

test("看板 ?t= 带回板级时间覆盖；坏掉的参数当没有", () => {
  const time = { window: { kind: "trailing", count: 12, unit: "month", grain: "month" } } as const;
  const parsed = parseRoute(boardHash("b1", time));
  expect(parsed.page).toBe("board");
  expect(parsed.page === "board" && parsed.time).toEqual(time);
  expect(parseRoute("#/board/b1?t=%7Bnot-json")).toEqual({ page: "board", id: "b1" });
  expect(parseRoute(boardHash("b1"))).toEqual({ page: "board", id: "b1" });
});

test("空串与未知段归报告列表", () => {
  expect(parseRoute("")).toEqual({ page: "reports", facet: "reports" });
  expect(parseRoute("#/")).toEqual({ page: "reports", facet: "reports" });
  expect(parseRoute("#/nowhere")).toEqual({ page: "reports", facet: "reports" });
});
