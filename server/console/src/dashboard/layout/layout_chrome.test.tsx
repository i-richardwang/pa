/**
 * 右栏几何归壳：宽度常量是唯一出处，壳读它下发；页面不写宽度，故只断言常量本身可防漂移。
 */
import { expect, test } from "bun:test";
import { STAGE_ASIDE_WIDTH } from "./layout_chrome";

test("右栏宽度按用途分两档", () => {
  expect(STAGE_ASIDE_WIDTH.settings).toBe(320);
  expect(STAGE_ASIDE_WIDTH.profile).toBeGreaterThan(STAGE_ASIDE_WIDTH.settings);
});
