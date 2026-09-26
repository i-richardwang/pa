import { expect, test } from "bun:test";
import { STAGE_ASIDE_WIDTH } from "./layout_chrome";

test("右栏宽度按用途分两种", () => {
  expect(STAGE_ASIDE_WIDTH.settings).toBe(320);
  expect(STAGE_ASIDE_WIDTH.profile).toBeGreaterThan(STAGE_ASIDE_WIDTH.settings);
});
