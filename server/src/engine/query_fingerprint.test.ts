import { describe, expect, test } from "bun:test";
import { derivedFormulaSummaries, queryFingerprint } from "./query_fingerprint.js";

const QUERY_FINGERPRINT_PATTERN = /^q-[0-9a-f]{10}$/;

const queryView = (title = "结果", cutoff = "2026-07") => ({
  view_title: title,
  measures: ["measure:active_employee_count"],
  dimensions: ["dimension:organization_name"],
  filters: [
    {
      member: "dimension:organization_name",
      relation: "one_of" as const,
      values: ["Aurora Labs"],
    },
    { member: "dimension:category_level", relation: "one_of" as const, values: ["Band C"] },
  ],
  time: {
    window: { kind: "current_month", month: cutoff },
  },
});

const spec = (query: unknown, derived?: unknown) => ({
  title: "在职人数",
  query,
  ...(derived ? { derived } : {}),
});

describe("queryFingerprint", () => {
  test("canonical 语义规格生成稳定短哈希", () => {
    const fingerprint = queryFingerprint(spec(queryView()));
    expect(fingerprint).toMatch(QUERY_FINGERPRINT_PATTERN);
    expect(queryFingerprint(spec(queryView()))).toBe(fingerprint);
  });

  test("标题、过滤顺序与对象键序不影响内容身份", () => {
    const fingerprint = queryFingerprint(spec(queryView()));
    const view = queryView();
    view.view_title = "另一标签";
    view.filters = [...view.filters].reverse().map((filter) => ({
      values: filter.values,
      relation: filter.relation,
      member: filter.member,
    }));
    const renamed = spec(view);
    renamed.title = "另一标题";
    expect(queryFingerprint(renamed)).toBe(fingerprint);
  });

  test("集合筛选的值顺序、空白与重复项不改变内容身份", () => {
    const canonical = queryView();
    canonical.filters[0].values = ["Aurora Labs", "Harbor Works"];
    const fingerprint = queryFingerprint(spec(canonical));
    const reordered = queryView();
    reordered.filters[0].values = [" Harbor Works ", "Aurora Labs", "Aurora Labs"];
    expect(queryFingerprint(spec(reordered))).toBe(fingerprint);
  });

  test("组合表保留列期间，筛选顺序不影响指纹", () => {
    const { filters } = queryView();
    const composition = (to: string, reverse: boolean) => ({
      composition: {
        group_by: "dimension:department_id",
        filters: reverse ? filters.toReversed() : filters,
        columns: ["first", "second"].map((id) => ({
          id,
          measure: "measure:active_employee_count",
          time: { window: { kind: "range", from: "2026-01", to } },
        })),
      },
    });
    const fingerprint = queryFingerprint(composition("2026-06", false));
    expect(fingerprint).toMatch(QUERY_FINGERPRINT_PATTERN);
    expect(queryFingerprint(composition("2026-06", true))).toBe(fingerprint);
    expect(queryFingerprint(composition("2026-07", false))).not.toBe(fingerprint);
  });

  test("数据选择、列序与派生算式参与指纹", () => {
    const fingerprint = queryFingerprint(spec(queryView()));
    const changed = queryView();
    changed.measures = ["measure:ytd_primary_event_rate"];
    expect(queryFingerprint(spec(changed))).not.toBe(fingerprint);

    const delta = {
      view_title: "差值",
      joined: {
        query: queryView("上年同期", "2025-07"),
        on: ["dimension:organization_name"],
        how: "left" as const,
      },
      columns: [
        { member: "dimension:organization_name", source: "query", as: "org" },
        {
          expr: {
            op: "-" as const,
            left: { member: "measure:active_employee_count", source: "query" },
            right: { member: "measure:active_employee_count", source: "joined" },
          },
          as: "delta",
        },
      ],
    };
    const derivedFingerprint = queryFingerprint(spec(queryView("当期"), delta));
    expect(derivedFingerprint).toMatch(QUERY_FINGERPRINT_PATTERN);
    expect(
      queryFingerprint(
        spec(queryView("当期"), {
          ...delta,
          columns: [delta.columns[0], { ...delta.columns[1], as: "renamed_delta" }],
        }),
      ),
    ).not.toBe(derivedFingerprint);
  });

  test("无效或物理规格不产生指纹", () => {
    expect(queryFingerprint({})).toBeUndefined();
    expect(queryFingerprint(spec({}))).toBeUndefined();
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

  test("派生观察只生成公式摘要，不复制完整分析入参", () => {
    expect(
      derivedFormulaSummaries(
        spec(queryView("当期"), {
          view_title: "变化",
          joined: {
            query: queryView("上年同期", "2025-07"),
            on: ["dimension:organization_name"],
            how: "left",
          },
          columns: [
            {
              expr: {
                op: "-",
                left: { member: "measure:active_employee_count", source: "query" },
                right: { member: "measure:active_employee_count", source: "joined" },
              },
              as: "headcount_delta",
            },
          ],
        }),
      ),
    ).toEqual([
      "headcount_delta = measure:active_employee_count(当期) − measure:active_employee_count(上年同期)",
    ]);
    expect(derivedFormulaSummaries({ invalid: true })).toEqual([]);
  });
});
