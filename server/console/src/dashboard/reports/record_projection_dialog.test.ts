import { expect, test } from "bun:test";
import { projectionPageOffset } from "./record_projection_dialog";

test("构成记录切换目标时首个请求从第一页开始", () => {
  const page = { requestKey: "report-a", offset: 50 };
  expect(projectionPageOffset(page, "report-a")).toBe(50);
  expect(projectionPageOffset(page, "report-b")).toBe(0);
  expect(projectionPageOffset(page, null)).toBe(0);
});
