import { describe, expect, test } from "bun:test";
import { authErrorText, parseAccessRole, toBetterAuthAdminRole } from "./better_auth_adapter";

describe("Better Auth dashboard adapter", () => {
  test("accepts exactly the supported roles and preserves their runtime values", () => {
    for (const role of ["user", "admin"] as const) {
      expect(String(toBetterAuthAdminRole(parseAccessRole(role)))).toBe(role);
    }
    expect(() => parseAccessRole("owner")).toThrow("未知数据角色");
  });

  test("normalizes Better Auth client errors for every dashboard consumer", () => {
    expect(authErrorText(null)).toBeNull();
    expect(authErrorText({ message: "邮箱已存在" })).toBe("邮箱已存在");
    expect(authErrorText({})).toBe("操作失败");
  });
});
