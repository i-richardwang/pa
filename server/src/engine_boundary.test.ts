/**
 * 源码扫描：指标计算只发生在指定位置（基于文本匹配，不能证明完全没有例外）。
 * - Cube 负责单张事实表内的汇总和 multi-stage 计算；
 * - metric_calculator 只计算正式指标依赖图里的跨事实表指标；
 * - transform 只计算查询里显式声明的结果级表达式；
 * - grouping_set_executor 只负责把粗粒度分组结果填回细粒度分组行；
 * - 其他服务、MCP adapter 和前端不做指标运算。
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
const TRANSFORM = "engine/transform.ts";
const METRIC_CALCULATOR = "engine/metric_calculator.ts";
const GROUPING_SET_EXECUTOR = "engine/grouping_set_executor.ts";
const isTransform = (file: string) => file === TRANSFORM;
const isMetricCalculator = (file: string) => file === METRIC_CALCULATOR;
const isGroupingSetExecutor = (file: string) => file === GROUPING_SET_EXECUTOR;

describe("度量计算边界", () => {
  test("占比只能由正式模型或报告规格声明，其他代码不自行计算占比", () => {
    expect(derivesShare("function derive_share() {}"), "匹配规则应能发现占比计算").toBe(true);
    expect(derivesShare("function render() {}"), "匹配规则误报了普通函数").toBe(false);
    for (const { file, text } of sources.filter(
      ({ file }) => !isTransform(file) && !isMetricCalculator(file) && !isGroupingSetExecutor(file),
    )) {
      expect(derivesShare(text), `${file} 自行计算了占比`).toBe(false);
    }
    const semanticSpec = sources.find(
      ({ file }) => file === "semantic_core/semantic_analysis.ts",
    )?.text;
    expect(semanticSpec).toContain('z.literal("percent_of_total")');
  });

  test("源码里没有把行值转成数字后相除或累加的写法", () => {
    expect(rowArithmetic("const ratio = Number(row.x) / Number(row.y)")).toHaveLength(1);
    expect(rowArithmetic("const value = Number(row.x)")).toEqual([]);
    const offending: string[] = [];
    for (const { file, text } of sources.filter(
      ({ file }) => !isTransform(file) && !isMetricCalculator(file) && !isGroupingSetExecutor(file),
    )) {
      offending.push(...rowArithmetic(text).map((line) => `${file}:${line}`));
    }
    expect(offending).toEqual([]);
  });

  test("派生表达式和 grouping-set 填充各自只在一个文件里执行", () => {
    const transform = sources.find(({ file }) => isTransform(file))?.text ?? "";
    const groupingSet = sources.find(({ file }) => isGroupingSetExecutor(file))?.text ?? "";
    expect(transform).toContain("function evaluate(");
    expect(groupingSet).toContain("applyGroupingSets(");
    expect(groupingSet).not.toContain("division_by_zero");
    expect(groupingSet).not.toContain("missing:");
    for (const { file, text } of sources.filter(({ file }) => !isTransform(file))) {
      expect(text.includes("transformDerivedView("), `${file} 不应另起变换执行点`).toBe(
        file === "application/query_pipeline.ts",
      );
    }
  });

  test("正式指标的 Planner、Calculator 和 Executor 职责互不重叠", () => {
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

  test("结果里的时间列由执行计划生成，在返回结果时合并", () => {
    const pipeline =
      sources.find(({ file }) => file === "application/query_pipeline.ts")?.text ?? "";
    const execution =
      sources.find(({ file }) => file === "application/query_execution_service.ts")?.text ?? "";
    const resultBlock =
      sources.find(({ file }) => file === "application/query_result_block.ts")?.text ?? "";
    expect(execution).toContain("encodeQueryResult(");
    expect(resultBlock).toContain("metricTimeMembers(queryPlan)");
    expect(resultBlock).toContain("resolvedDeliveryColumns");
    expect(pipeline).toContain("deliveredResult.resolvedDeliveryColumns");
  });

  test("扫描范围覆盖引擎、服务、存储和共享契约目录", () => {
    const files = new Set(sources.map(({ file }) => file));
    expect(files).toContain(TRANSFORM);
    expect(files).toContain("engine/metric_planner.ts");
    expect(files).toContain(METRIC_CALCULATOR);
    expect(files).toContain(GROUPING_SET_EXECUTOR);
    expect(files).toContain("engine/grouping_set_planner.ts");
    expect(files).toContain("engine/metric_executor.ts");
    expect(files).toContain("engine/time_plan.ts");
    expect(files).toContain("application/query_execution_service.ts");
    expect(files).toContain("application/query_pipeline.ts");
    expect(files).toContain("storage/report_repository.ts");
    expect(files).toContain("semantic_core/analysis_spec.ts");
  });
});
