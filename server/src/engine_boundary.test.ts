/**
 * 度量计算边界不变式（tripwire，非完备证明）：
 * - Cube 负责单事实聚合与事实内 multi-stage；
 * - metric_calculator 只执行正式指标图声明的跨事实节点；
 * - transform 只执行查询工件显式声明的结果级标量表达式；
 * - 其余服务、MCP adapter 与前端不得自行实现度量算术。
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = import.meta.dir;
const sources = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
  .map((file) => {
    const absolute = join(SRC, file);
    return {
      file: relative(SRC, absolute),
      text: readFileSync(absolute, "utf8"),
    };
  });

const derivesShare = (text: string) => /derive_?share/i.test(text);
const rowArithmetic = (text: string): string[] =>
  text
    .split("\n")
    .flatMap((line, index) =>
      line.includes("Number(") && /Number\([^)]*\)\s*\/|\/\s*Number\(|\+=\s*Number\(/.test(line)
        ? [`${index + 1}: ${line.trim()}`]
        : [],
    );
/** 查询工件标量变换的唯一执行点。 */
const TRANSFORM = "engine/transform.ts";
/** 正式指标图节点的唯一计算点。 */
const METRIC_CALCULATOR = "engine/metric_calculator.ts";
const isTransform = (file: string) => file === TRANSFORM;
const isMetricCalculator = (file: string) => file === METRIC_CALCULATOR;

describe("度量计算边界", () => {
  // 报告级占比也只能通过语义规格进入统一 Planner，壳与前端仍不得直接对结果行求和。
  test("占比只由正式模型或受控报告规格声明，MCP 壳内不实现派生", () => {
    expect(derivesShare("function derive_share() {}"), "探针必须能发现占比派生").toBe(true);
    expect(derivesShare("function render() {}"), "探针不得误报普通函数").toBe(false);
    for (const { file, text } of sources.filter(
      ({ file }) => !isTransform(file) && !isMetricCalculator(file),
    )) {
      expect(derivesShare(text), `${file} 在壳内派生占比`).toBe(false);
    }
    const semanticSpec = sources.find(
      ({ file }) => file === "semantic_core/semantic_analysis.ts",
    )?.text;
    expect(semanticSpec).toContain('z.literal("percent_of_total")');
  });

  test("源码无典型的「行值转数 × 除法/累加」形态", () => {
    expect(rowArithmetic("const ratio = Number(row.x) / Number(row.y)")).toHaveLength(1);
    expect(rowArithmetic("const value = Number(row.x)")).toEqual([]);
    const offending: string[] = [];
    for (const { file, text } of sources.filter(
      ({ file }) => !isTransform(file) && !isMetricCalculator(file),
    )) {
      offending.push(...rowArithmetic(text).map((line) => `${file}:${line}`));
    }
    expect(offending).toEqual([]);
  });

  test("声明式标量变换只有 engine/transform.ts 一个执行点", () => {
    const transform = sources.find(({ file }) => isTransform(file))?.text ?? "";
    expect(transform).toContain("function evaluate(");
    for (const { file, text } of sources.filter(({ file }) => !isTransform(file))) {
      expect(text.includes("transformDerivedView("), `${file} 不应另起变换执行点`).toBe(
        file === "application/query_pipeline.ts",
      );
    }
  });

  test("正式指标 Planner、Calculator 与 Executor 各自只承担一种职责", () => {
    const planner = sources.find(({ file }) => file === "engine/metric_planner.ts")?.text ?? "";
    const calculator = sources.find(({ file }) => isMetricCalculator(file))?.text ?? "";
    const executor = sources.find(({ file }) => file === "engine/metric_executor.ts")?.text ?? "";
    expect(planner).toContain("planMetricQuery");
    expect(planner).not.toContain("CubeGateway");
    expect(planner).not.toContain("alignMetricLoads");
    expect(calculator).toContain("alignMetricLoads");
    expect(calculator).toContain("metricValue");
    expect(calculator).not.toContain("CubeGateway");
    expect(executor).toContain('from "./metric_planner.js"');
    expect(executor).toContain('from "./metric_calculator.js"');
    expect(executor).not.toContain("numerator / denominator");
  });

  test("递归扫描覆盖引擎、服务、存储与共享契约目录", () => {
    const files = new Set(sources.map(({ file }) => file));
    expect(files).toContain(TRANSFORM);
    expect(files).toContain("engine/metric_planner.ts");
    expect(files).toContain(METRIC_CALCULATOR);
    expect(files).toContain("engine/metric_executor.ts");
    expect(files).toContain("engine/time_plan.ts");
    expect(files).toContain("application/query_execution_service.ts");
    expect(files).toContain("application/query_pipeline.ts");
    expect(files).toContain("storage/report_repository.ts");
    expect(files).toContain("semantic_core/analysis_spec.ts");
  });
});
