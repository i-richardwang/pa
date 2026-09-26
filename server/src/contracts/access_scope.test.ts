import { describe, expect, test } from "bun:test";
import {
  ACCESS_SCOPE_SCHEMA,
  accessScopeValues,
  parseStoredAccessScope,
  serializeAccessScope,
} from "./access_scope.js";

describe("access scope contract", () => {
  test("限定值去除首尾空白、去重并保持顺序", () => {
    expect(
      ACCESS_SCOPE_SCHEMA.parse({
        kind: "limited",
        values: [" North ", "West", "North"],
      }),
    ).toEqual({ kind: "limited", values: ["North", "West"] });
  });

  test("存储值只在是结构化 JSON 且 scope_id 与当前一致时生效", () => {
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

  test("序列化时写入 scope_id，Cube 过滤值只含授权值本身", () => {
    const scope = { kind: "limited" as const, values: ["North"] };
    expect(serializeAccessScope(scope, "region")).toBe(
      '{"scope_id":"region","kind":"limited","values":["North"]}',
    );
    expect(accessScopeValues(scope)).toEqual(["North"]);
    expect(accessScopeValues({ kind: "all" })).toBe("*");
  });
});
