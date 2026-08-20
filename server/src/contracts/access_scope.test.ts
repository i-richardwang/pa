import { describe, expect, test } from "bun:test";
import {
  ACCESS_SCOPE_SCHEMA,
  accessScopeValues,
  parseStoredAccessScope,
  serializeAccessScope,
} from "./access_scope.js";

describe("access scope contract", () => {
  test("限定值在领域边界去空白、去重并保持顺序", () => {
    expect(
      ACCESS_SCOPE_SCHEMA.parse({
        kind: "limited",
        values: [" North ", "West", "North"],
      }),
    ).toEqual({ kind: "limited", values: ["North", "West"] });
  });

  test("持久化只接受绑定当前授权身份的结构化值", () => {
    expect(parseStoredAccessScope('{"scope_id":"region","kind":"all"}', "region")).toEqual({
      kind: "all",
    });
    expect(
      parseStoredAccessScope(
        '{"scope_id":"region","kind":"limited","values":["North","West"]}',
        "region",
      ),
    ).toEqual({
      kind: "limited",
      values: ["North", "West"],
    });
    expect(parseStoredAccessScope('{"scope_id":"organization","kind":"all"}', "region")).toEqual({
      kind: "limited",
      values: [],
    });
    expect(parseStoredAccessScope("North,West", "region")).toEqual({
      kind: "limited",
      values: [],
    });
  });

  test("持久化绑定稳定授权身份，Cube 过滤值保持业务无关", () => {
    const scope = { kind: "limited" as const, values: ["North"] };
    expect(serializeAccessScope(scope, "region")).toBe(
      '{"scope_id":"region","kind":"limited","values":["North"]}',
    );
    expect(accessScopeValues(scope)).toEqual(["North"]);
    expect(accessScopeValues({ kind: "all" })).toBe("*");
  });
});
