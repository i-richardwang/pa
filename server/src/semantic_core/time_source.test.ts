import { describe, expect, test } from "bun:test";
import { buildTimeSourceRegistry, timeSourceLabel } from "./time_source.js";

const inputs = [
  {
    id: "sales_actual",
    title: "Sales actuals",
    role: "actual" as const,
    primary: true,
    comparison_policy: "calendar" as const,
  },
  {
    id: "sales_plan",
    title: "Sales plan",
    role: "plan" as const,
    primary: false,
    reference_source: "sales_actual",
    comparison_policy: "calendar" as const,
  },
  {
    id: "inventory_count",
    title: "Inventory counts",
    role: "actual" as const,
    primary: false,
    comparison_policy: "explicit_only" as const,
  },
];

describe("通用时间源注册表", () => {
  test("装配非 HR 实际、计划和显式对照时钟", () => {
    const registry = buildTimeSourceRegistry(inputs);
    expect(registry.primary.id).toBe("sales_actual");
    expect(registry.by_id.get("sales_plan")?.reference_source).toBe("sales_actual");
    expect(registry.by_id.get("inventory_count")?.comparison_policy).toBe("explicit_only");
    expect(timeSourceLabel(registry, "inventory_count")).toBe("Inventory counts");
  });

  test("主时钟和计划基准关系 fail-closed", () => {
    expect(() =>
      buildTimeSourceRegistry(inputs.map((source) => ({ ...source, primary: false }))),
    ).toThrow("只能声明一个主时间来源");
    expect(() =>
      buildTimeSourceRegistry([inputs[0], { ...inputs[1], reference_source: "missing_actual" }]),
    ).toThrow("未登记的基准");
    expect(() =>
      buildTimeSourceRegistry([inputs[0], { ...inputs[1], reference_source: "sales_plan" }]),
    ).toThrow("必须引用 actual 基准");
  });
});
