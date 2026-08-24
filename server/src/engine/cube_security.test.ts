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
  test("Better Auth 字段统一解析角色与数据范围", () => {
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

  test("已知角色按组织范围映射到唯一策略组", () => {
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

  test("数据角色只有 user 与 admin，策略组因此只按数据范围分", () => {
    expect(
      [...DATA_ROLES].sort(),
      "新增了数据角色：cubeSecurityContext 只按数据范围映射策略组，前提是所有数据角色在列权限上等价——新角色若不等价，它拿到的会是别人的列",
    ).toEqual(["admin", "user"]);
  });

  test("多角色不叠加策略，当前等价角色仍只产生一个组", () => {
    expect(
      cubeSecurityContext({
        email: "admin@example.com",
        roles: ["admin", "user"],
        accessScope: { kind: "all" },
      }).groups,
    ).toEqual([CUBE_ACCESS_GROUP.full]);
  });

  test("未知角色与空组织范围 fail-closed", () => {
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

  test("服务身份与用户策略组分离", () => {
    expect(SERVICE_CUBE_CONTEXT).toEqual({
      subject: "pa-service",
      groups: [CUBE_ACCESS_GROUP.service],
      accessScope: { kind: "all" },
    });
  });
});
