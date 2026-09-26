import { describe, expect, test } from "bun:test";
import {
  AuthzError,
  CUBE_ACCESS_GROUP,
  DATA_ROLES,
  SERVICE_CUBE_CONTEXT,
  cubeSecurityContext,
} from "./cube_security.js";
import { principalFromAttributes, type Principal } from "../contracts/principal.js";

describe("Cube securityContext 映射", () => {
  test("从 Better Auth 用户字段解析角色与数据范围", () => {
    expect(
      principalFromAttributes(
        {
          email: "user@example.com",
          role: "user, admin ",
          access_scope:
            '{"scope_id":"organization","kind":"limited","values":["Aurora Labs","Harbor Works"]}',
        },
        { id: "organization", title: "组织" },
      ),
    ).toEqual({
      email: "user@example.com",
      roles: ["user", "admin"],
      accessScope: { kind: "limited", values: ["Aurora Labs", "Harbor Works"] },
    });
    expect(
      principalFromAttributes(
        {
          email: "admin@example.com",
          role: "admin",
          access_scope: '{"scope_id":"organization","kind":"all"}',
        },
        { id: "organization", title: "组织" },
      ),
    ).toEqual({
      email: "admin@example.com",
      roles: ["admin"],
      accessScope: { kind: "all" },
    });
  });

  test("数据角色按数据范围映射到一个策略组", () => {
    const full: Principal = {
      email: "admin@example.com",
      roles: ["admin"],
      accessScope: { kind: "all" },
    };
    const scoped: Principal = {
      email: "user@example.com",
      roles: ["user"],
      accessScope: { kind: "limited", values: ["Aurora Labs", "Harbor Works"] },
    };
    expect(cubeSecurityContext(full)).toEqual({
      subject: "admin@example.com",
      groups: [CUBE_ACCESS_GROUP.full],
      accessScope: { kind: "all" },
    });
    expect(cubeSecurityContext(scoped)).toEqual({
      subject: "user@example.com",
      groups: [CUBE_ACCESS_GROUP.scoped],
      accessScope: { kind: "limited", values: ["Aurora Labs", "Harbor Works"] },
    });
  });

  test("数据角色只有 user 与 admin", () => {
    expect(
      [...DATA_ROLES].sort(),
      "新增了数据角色：cubeSecurityContext 只按数据范围映射策略组，前提是所有数据角色在列权限上等价——新角色若不等价，它拿到的会是别人的列",
    ).toEqual(["admin", "user"]);
  });

  test("多角色账号只映射到一个策略组", () => {
    expect(
      cubeSecurityContext({
        email: "admin@example.com",
        roles: ["admin", "user"],
        accessScope: { kind: "all" },
      }).groups,
    ).toEqual([CUBE_ACCESS_GROUP.full]);
  });

  test("没有数据角色或数据范围为空时抛出 AuthzError", () => {
    expect(() =>
      cubeSecurityContext({ email: "x@x", roles: [], accessScope: { kind: "all" } }),
    ).toThrow(AuthzError);
    expect(() =>
      cubeSecurityContext({
        email: "y@example.com",
        roles: ["user"],
        accessScope: { kind: "limited", values: [] },
      }),
    ).toThrow(AuthzError);
  });

  test("服务身份使用独立的策略组", () => {
    expect(SERVICE_CUBE_CONTEXT).toEqual({
      subject: "pa-service",
      groups: [CUBE_ACCESS_GROUP.service],
      accessScope: { kind: "all" },
    });
  });
});
