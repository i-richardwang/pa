/** 源码扫描：所有查询执行都必须经过 ExecutionPlan。这是基于文本匹配的检查，不能证明完全没有绕过。 */
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

const plansExecution = (text: string) => /planExecution\s*\(/.test(text);
const forgesPlanBrand = (text: string) => /as\s+(?:unknown\s+as\s+)?ExecutionPlan\b/.test(text);

// 允许调用 planExecution 的文件。
const PLANNER_ENTRIES = new Set([
  "semantic_core/execution_plan.ts",
  "engine/semantic_analysis_compiler.ts",
  "test_support/dashboard.ts",
]);

describe("执行计划边界", () => {
  test("匹配规则能识别违规写法，且不误报正常写法", () => {
    expect(plansExecution("const p = planExecution(spec)")).toBe(true);
    expect(plansExecution("const p = compiled.plan")).toBe(false);
    expect(forgesPlanBrand("return x as ExecutionPlan")).toBe(true);
    expect(forgesPlanBrand("return x as unknown as ExecutionPlan")).toBe(true);
    expect(forgesPlanBrand("const p: ExecutionPlan = plan")).toBe(false);
  });

  test("执行器只接收编译好的 plan，自己不调用规划", () => {
    const pipeline = sourceOf("application/query_pipeline.ts");
    expect(pipeline, "扫描没有找到执行器文件").toContain("runQueryPipeline");
    expect(pipeline).toContain("plan: ExecutionPlan");
    expect(plansExecution(pipeline), "执行器不得调用 planExecution").toBe(false);
  });

  test("已拿到编译 plan 的调用方不重新规划", () => {
    for (const file of ["application/report_service.ts", "dashboard/analyses.ts"]) {
      const text = sourceOf(file);
      expect(text, `扫描没有找到 ${file}`).not.toBe("");
      expect(plansExecution(text), `${file} 应直接使用 compiled.plan，不能重新规划`).toBe(false);
    }
  });

  test("planExecution 只在规划入口被调用", () => {
    const callers = sources.filter(({ text }) => plansExecution(text)).map(({ file }) => file);
    for (const file of callers) {
      expect(PLANNER_ENTRIES.has(file), `${file} 不应调用 planExecution`).toBe(true);
    }
    // 如果扫描漏掉了文件，这里会失败。
    expect(callers).toContain("semantic_core/execution_plan.ts");
    expect(callers).toContain("engine/semantic_analysis_compiler.ts");
  });

  test("只有 execution_plan.ts 能把值转换成 ExecutionPlan 类型", () => {
    const forgers = sources.filter(({ text }) => forgesPlanBrand(text)).map(({ file }) => file);
    expect(forgers).toEqual(["semantic_core/execution_plan.ts"]);
  });
});
