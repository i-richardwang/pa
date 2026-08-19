import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { USAGE_ERROR_GROUP_TEXT_LIMIT } from "./contracts/usage_contract.js";

const repoRoot = new URL("../../", import.meta.url);

test("TypeScript and Python group usage errors with the same text limit", async () => {
  const source = await readFile(new URL("scripts/usage_report.py", repoRoot), "utf8");
  const declaration = source.match(/^USAGE_ERROR_GROUP_TEXT_LIMIT\s*=\s*(\d+)$/m);

  expect(declaration).not.toBeNull();
  expect(Number(declaration?.[1])).toBe(USAGE_ERROR_GROUP_TEXT_LIMIT);
  // Every truncation site interpolates the shared constant, so the two languages cannot drift apart.
  expect([...source.matchAll(/substr\(error,[^)]*\)/g)].map((match) => match[0])).toEqual([
    "substr(error, 1, {USAGE_ERROR_GROUP_TEXT_LIMIT})",
  ]);
});
