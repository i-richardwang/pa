import { describe, expect, test } from "bun:test";
import { authErrorText } from "./better_auth_adapter";

describe("Better Auth dashboard adapter", () => {
  test("normalizes Better Auth client errors for every dashboard consumer", () => {
    expect(authErrorText(null)).toBeNull();
    expect(authErrorText({ message: "邮箱已存在" })).toBe("邮箱已存在");
    expect(authErrorText({})).toBe("操作失败");
  });
});
