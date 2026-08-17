import { describe, expect, test } from "bun:test";
import {
  AuthzError,
  CUBE_ACCESS_GROUP,
  SERVICE_CUBE_CONTEXT,
  cubeSecurityContext,
  principalFromAttributes,
  type Principal,
} from "./cube_security.js";

describe("Cube securityContext 映射", () => {
  test("Better Auth 字段统一解析角色与组织范围", () => {
    expect(
      principalFromAttributes({
        email: "user@example.com",
        role: "user, admin ",
        org_scope: " Aurora Labs, Harbor Works ",
      }),
    ).toEqual({
      email: "user@example.com",
      roles: ["user", "admin"],
      orgScope: ["Aurora Labs", "Harbor Works"],
    });
    expect(
      principalFromAttributes({ email: "admin@example.com", role: "admin", org_scope: "*" }),
    ).toEqual({
      email: "admin@example.com",
      roles: ["admin"],
      orgScope: "*",
    });
  });

  test("已知角色按组织范围映射到唯一策略组", () => {
    const full: Principal = { email: "admin@example.com", roles: ["admin"], orgScope: "*" };
    const scoped: Principal = {
      email: "user@example.com",
      roles: ["user"],
      orgScope: ["Aurora Labs", "Harbor Works"],
    };
    expect(cubeSecurityContext(full)).toEqual({
      subject: "admin@example.com",
      groups: [CUBE_ACCESS_GROUP.full],
      orgScope: "*",
    });
    expect(cubeSecurityContext(scoped)).toEqual({
      subject: "user@example.com",
      groups: [CUBE_ACCESS_GROUP.scoped],
      orgScope: ["Aurora Labs", "Harbor Works"],
    });
  });

  test("多角色不叠加策略，当前等价角色仍只产生一个组", () => {
    expect(
      cubeSecurityContext({ email: "admin@example.com", roles: ["admin", "user"], orgScope: "*" })
        .groups,
    ).toEqual([CUBE_ACCESS_GROUP.full]);
  });

  test("未知角色与空组织范围 fail-closed", () => {
    expect(() => cubeSecurityContext({ email: "x@x", roles: [], orgScope: "*" })).toThrow(
      AuthzError,
    );
    expect(() =>
      cubeSecurityContext({ email: "y@example.com", roles: ["user"], orgScope: [] }),
    ).toThrow(AuthzError);
  });

  test("服务身份与用户策略组分离", () => {
    expect(SERVICE_CUBE_CONTEXT).toEqual({
      subject: "pa-service",
      groups: [CUBE_ACCESS_GROUP.service],
      orgScope: "*",
    });
  });
});
