import { expect, test } from "bun:test";
import { createRequestCoordinator } from "./request_coordinator.js";

test("新请求使旧响应失效，关闭后不再发放请求身份", () => {
  const requests = createRequestCoordinator();
  const first = requests.begin();
  const second = requests.begin();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(requests.isCurrent(first!)).toBe(false);
  expect(requests.isCurrent(second!)).toBe(true);

  requests.invalidate();
  expect(requests.isCurrent(second!)).toBe(false);

  requests.close();
  expect(requests.begin()).toBeNull();
  expect(requests.isClosed()).toBe(true);
});
