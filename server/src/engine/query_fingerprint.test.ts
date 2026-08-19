import { describe, expect, test } from "bun:test";
import { QUERY_FINGERPRINT_PATTERN, queryFingerprint } from "./query_fingerprint.js";

const queryView = (id = "source", cutoff = "2026-07") => ({
  id,
  view_title: "结果",
  measures: ["active_employee_count"],
  dimensions: ["organization_name"],
  filters: [
    { member: "organization_name", relation: "one_of" as const, values: ["Aurora Labs"] },
    { member: "category_level", relation: "one_of" as const, values: ["Band C"] },
  ],
  time: {
    window: { kind: "current_month", month: cutoff },
  },
});

const spec = (views: unknown[]) => ({
  title: "在职人数",
  views,
});

describe("queryFingerprint", () => {
  test("canonical 语义规格生成稳定短哈希", () => {
    const fingerprint = queryFingerprint(spec([queryView()]));
    expect(fingerprint).toMatch(QUERY_FINGERPRINT_PATTERN);
    expect(queryFingerprint(spec([queryView()]))).toBe(fingerprint);
  });

  test("标题、局部 id、过滤顺序与对象键序不影响内容身份", () => {
    const fingerprint = queryFingerprint(spec([queryView()]));
    const view = queryView("renamed");
    view.view_title = "另一标签";
    view.filters = [...view.filters].reverse().map((filter) => ({
      values: filter.values,
      relation: filter.relation,
      member: filter.member,
    }));
    const renamed = spec([view]);
    renamed.title = "另一标题";
    expect(queryFingerprint(renamed)).toBe(fingerprint);
  });

  test("集合筛选的值顺序、空白与重复项不改变内容身份", () => {
    const canonical = queryView();
    canonical.filters[0].values = ["Aurora Labs", "Harbor Works"];
    const fingerprint = queryFingerprint(spec([canonical]));
    const reordered = queryView();
    reordered.filters[0].values = [" Harbor Works ", "Aurora Labs", "Aurora Labs"];
    expect(queryFingerprint(spec([reordered]))).toBe(fingerprint);
  });

  test("数据选择、列序与派生算式参与指纹", () => {
    const fingerprint = queryFingerprint(spec([queryView()]));
    const changed = queryView();
    changed.measures = ["ytd_primary_event_rate"];
    expect(queryFingerprint(spec([changed]))).not.toBe(fingerprint);

    const delta = {
      id: "delta",
      view_title: "差值",
      from: ["current", "previous"],
      join: { on: ["organization_name"], how: "left" as const },
      columns: [
        { member: "organization_name", source: "current", as: "组织" },
        {
          expr: {
            op: "-" as const,
            left: { member: "active_employee_count", source: "current" },
            right: { member: "active_employee_count", source: "previous" },
          },
          as: "delta",
        },
      ],
    };
    const comparison = spec([queryView("current"), queryView("previous", "2025-07"), delta]);
    const derivedFingerprint = queryFingerprint(comparison);
    expect(derivedFingerprint).toMatch(QUERY_FINGERPRINT_PATTERN);
    expect(
      queryFingerprint(
        spec([
          queryView("current"),
          queryView("previous", "2025-07"),
          {
            ...delta,
            columns: [delta.columns[0], { ...delta.columns[1], as: "renamed_delta" }],
          },
        ]),
      ),
    ).not.toBe(derivedFingerprint);
  });

  test("多个独立终点不是合法的可指纹分析", () => {
    const views = [queryView("current"), queryView("previous", "2025-07")];
    expect(queryFingerprint(spec(views))).toBeUndefined();
  });

  test("无效或物理规格不产生指纹", () => {
    expect(queryFingerprint({})).toBeUndefined();
    expect(queryFingerprint(spec([]))).toBeUndefined();
    // 物理 view 限定成员不是语义入口的合法输入
    expect(
      queryFingerprint({
        views: [
          {
            id: "x",
            measures: ["test_people_metrics.active_employee_count"],
            time: { cutoff: "2026-07" },
          },
        ],
      }),
    ).toBeUndefined();
  });
});
