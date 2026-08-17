/**
 * 执行计划边界不变式（tripwire，非完备证明）：ExecutionPlan 是不可绕过的唯一内部执行边界。
 * 三条铁律：
 *   ① 执行器（query_pipeline）只消费不透明 plan，绝不自行 planExecution；
 *   ② 已持有编译 plan 的路径（report_service / dashboard 分析路由）直接递入该 plan，避免重复规划；
 *   ③ plan 只能由 semantic_core/execution_plan.ts 的 planExecution 打品牌产出，别处无从伪造。
 * 每条断言都配活性探针：已知坏输入必中、干净输入必不中。
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = import.meta.dir;
const sources = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
  .map((file) => {
    const absolute = join(SRC, file);
    return { file: relative(SRC, absolute), text: readFileSync(absolute, "utf8") };
  });

const sourceOf = (file: string) => sources.find((entry) => entry.file === file)?.text ?? "";

/** 调用了 planner。 */
const plansExecution = (text: string) => /planExecution\s*\(/.test(text);
/** 以类型断言伪造 plan 品牌（含 double-cast）。 */
const forgesPlanBrand = (text: string) => /as\s+(?:unknown\s+as\s+)?ExecutionPlan\b/.test(text);

// 规划入口——唯一允许调用 planExecution 的地方。唯一的生产规划点是 compiler：
// 语义规格 → 编译 → plan；服务层（analysis/export）一律消费编译产物，不自行规划。
const PLANNER_ENTRIES = new Set([
  "semantic_core/execution_plan.ts",
  "engine/semantic_analysis_compiler.ts",
  "test_support/dashboard.ts",
]);

describe("执行计划边界", () => {
  test("探针活性：坏输入必中、干净输入必不中", () => {
    expect(plansExecution("const p = planExecution(spec)")).toBe(true);
    expect(plansExecution("const p = compiled.plan")).toBe(false);
    expect(forgesPlanBrand("return x as ExecutionPlan")).toBe(true);
    expect(forgesPlanBrand("return x as unknown as ExecutionPlan")).toBe(true);
    expect(forgesPlanBrand("const p: ExecutionPlan = plan")).toBe(false);
  });

  test("执行器只消费不透明 plan，绝不自行规划", () => {
    const pipeline = sourceOf("application/query_pipeline.ts");
    expect(pipeline, "扫描必须命中执行器").toContain("runQueryPipeline");
    expect(pipeline).toContain("plan: ExecutionPlan");
    expect(plansExecution(pipeline), "执行器不得调用 planExecution").toBe(false);
  });

  test("已持有编译 plan 的路径不得重规划", () => {
    for (const file of ["application/report_service.ts", "dashboard/analyses.ts"]) {
      const text = sourceOf(file);
      expect(text, `扫描必须命中 ${file}`).not.toBe("");
      expect(plansExecution(text), `${file} 应直接递入 compiled.plan，不得重规划`).toBe(false);
    }
  });

  test("planExecution 只在规划入口被调用", () => {
    const callers = sources.filter(({ text }) => plansExecution(text)).map(({ file }) => file);
    for (const file of callers) {
      expect(PLANNER_ENTRIES.has(file), `${file} 越权调用了 planExecution`).toBe(true);
    }
    // 活性：定义点与唯一生产规划点（compiler）必须确实在调用集里，否则说明扫描漏了文件。
    expect(callers).toContain("semantic_core/execution_plan.ts");
    expect(callers).toContain("engine/semantic_analysis_compiler.ts");
  });

  test("plan 品牌只在 execution_plan.ts 打上，别处无从伪造", () => {
    const forgers = sources.filter(({ text }) => forgesPlanBrand(text)).map(({ file }) => file);
    expect(forgers).toEqual(["semantic_core/execution_plan.ts"]);
  });
});
