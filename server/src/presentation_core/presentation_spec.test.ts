import { describe, expect, test } from "bun:test";
import { parseAnalysisSpec } from "../semantic_core/analysis_spec.js";
import { chartContextForView, parsePresentationSpec } from "./presentation_spec.js";

const analysis = parseAnalysisSpec({
  views: [
    {
      id: "current",
      view_title: "本期人员数据",
      measures: ["test_people_metrics.active_employee_count"],
      dimensions: ["test_people_metrics.organization_name"],
      time: { cutoff: "2026-07" },
    },
    {
      id: "comparison",
      view_title: "对比",
      from: ["current"],
      columns: [
        { col: "organization_name", source: "current" },
        { col: "active_employee_count", source: "current", as: "本期人数" },
        {
          expr: {
            op: "-",
            left: { col: "active_employee_count", source: "current" },
            right: { lit: 1 },
          },
          as: "变化",
        },
      ],
    },
  ],
});

describe("PresentationSpec", () => {
  test("呈现声明直接绑定唯一结果", () => {
    expect(
      parsePresentationSpec({ type: "bar", x: "organization_name", y: ["本期人数"] }, analysis),
    ).toEqual({
      type: "bar",
      x: "organization_name",
      y: ["本期人数"],
    });
  });

  test("派生视图能从来源规格识别搬运度量和维度", () => {
    const context = chartContextForView(analysis.views[1], analysis);
    expect(context.dimensions).toEqual(["organization_name"]);
    expect(context.measures).toEqual(["本期人数", "变化"]);
  });

  test("保存前完整校验交付结果的图表字段绑定", () => {
    expect(() => parsePresentationSpec({ type: "bar", x: "missing_dimension" }, analysis)).toThrow(
      /presentation\.x.*不在本视图 dimensions/,
    );
  });
});
