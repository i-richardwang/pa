/**
 * 载荷派生逻辑单测：卡片标题的"度量 · 按维度 · 趋势"组合（显示名剥前缀已在契约模块单测覆盖）。
 * 派生单位是单个视图（ViewBlock）；卡片标题另接回答级 payload.title。
 */
import { describe, expect, test } from "bun:test";
import { cardTitle, headerSubtitle, headerTitle } from "./derive.js";
import type { QueryPayload, ViewBlock } from "../../src/semantic_core/query_payload.js";

function view(
  columns: string[],
  rows: (string | number | null)[][],
  structure_shares?: ViewBlock["structure_shares"],
): ViewBlock {
  const columnRoles = Object.fromEntries(
    columns.map((column) => [
      column,
      column === "year" || column === "month"
        ? "time"
        : column === "organization_name" || column === "job_level_band"
          ? "dimension"
          : "measure",
    ]),
  ) as ViewBlock["column_roles"];
  return {
    id: "result",
    columns,
    column_roles: columnRoles,
    rows,
    row_count: rows.length,
    query_notes: [],
    ...(structure_shares ? { structure_shares } : {}),
  };
}

function answer(v: ViewBlock, title?: string): QueryPayload {
  return {
    ...(title ? { title } : {}),
    view: v,
    observation_scopes: [""],
    data_as_of: "2026-05",
    time_context: [],
  };
}

const titleOf = (c: string) => c;

describe("headerTitle", () => {
  test("与分子同查的占比列不进标题（它是分子度量的注释）", () => {
    const v = view(
      ["job_level_band", "active_employee_count", "active_employee_share"],
      [["Band B", 40, 0.4]],
      [
        {
          measure: "active_employee_share",
          numerator: "active_employee_count",
        },
      ],
    );
    expect(headerTitle(v, titleOf)).toBe("active_employee_count");
  });

  test("单独查询的占比列照常进标题（无分子可注释）", () => {
    const v = view(["job_level_band", "active_employee_share"], [["Band B", 40]]);
    expect(headerTitle(v, titleOf)).toBe("active_employee_share");
  });

  test("显式指标关系下多组占比都不重复进入标题", () => {
    const v = view(
      ["job_level_band", "hires", "hire_mix", "leavers", "leave_mix"],
      [["Band B", 40, 0.4, 30, 0.3]],
      [
        { measure: "hire_mix", numerator: "hires" },
        { measure: "leave_mix", numerator: "leavers" },
      ],
    );
    expect(headerTitle(v, titleOf)).toBe("hires、leavers");
  });

  test("多取值分类维度进标题（结构类查询标题带拆分维度）", () => {
    const v = view(
      ["job_level_band", "active_employee_count"],
      [
        ["Band B", 40],
        ["Band C", 30],
      ],
    );
    expect(headerTitle(v, titleOf)).toBe("active_employee_count · 按job_level_band");
  });

  test("取值唯一的分类列是过滤回显，不进标题", () => {
    const v = view(
      ["organization_name", "job_level_band", "active_employee_count"],
      [
        ["Aurora Labs", "Band B", 40],
        ["Aurora Labs", "Band C", 30],
      ],
    );
    expect(headerTitle(v, titleOf)).toBe("active_employee_count · 按job_level_band");
  });

  test("双分类维度以 × 连接", () => {
    const v = view(
      ["organization_name", "job_level_band", "active_employee_count"],
      [
        ["A", "Band B", 40],
        ["B", "Band C", 30],
      ],
    );
    expect(headerTitle(v, titleOf)).toBe(
      "active_employee_count · 按organization_name × job_level_band",
    );
  });

  test("多年时间轴标注年度趋势", () => {
    const v = view(
      ["year", "active_employee_count"],
      [
        [2024, 100],
        [2025, 110],
      ],
    );
    expect(headerTitle(v, titleOf)).toBe("active_employee_count · 年度趋势");
  });

  test("带 month 列的多时点标注月度趋势", () => {
    const v = view(
      ["year", "month", "active_employee_count"],
      [
        [2026, 1, 100],
        [2026, 2, 110],
      ],
    );
    expect(headerTitle(v, titleOf)).toBe("active_employee_count · 月度趋势");
  });

  test("单时点是过滤回显，不算趋势", () => {
    const v = view(
      ["year", "job_level_band", "active_employee_count"],
      [
        [2026, "Band B", 40],
        [2026, "Band C", 30],
      ],
    );
    expect(headerTitle(v, titleOf)).toBe("active_employee_count · 按job_level_band");
  });

  test("时间 × 分类 × 度量三段齐全", () => {
    const v = view(
      ["year", "job_level_band", "active_employee_count"],
      [
        [2024, "Band B", 40],
        [2024, "Band C", 30],
        [2025, "Band B", 45],
        [2025, "Band C", 35],
      ],
    );
    expect(headerTitle(v, titleOf)).toBe("active_employee_count · 按job_level_band · 年度趋势");
  });
});

describe("cardTitle 与 headerSubtitle", () => {
  const rows: (string | number | null)[][] = [
    ["Band B", 40],
    ["Band C", 30],
  ];

  test("调用方声明的标题优先，派生结构式降为副标题锚点", () => {
    const v = view(["job_level_band", "active_employee_count"], rows);
    const a = answer(v, "Aurora Labs 各职级人员结构");
    expect(cardTitle(a, v, titleOf)).toBe("Aurora Labs 各职级人员结构");
    expect(headerSubtitle(a, v, titleOf)).toBe("active_employee_count · 按job_level_band");
  });

  test("未声明标题时退派生标题，无副标题", () => {
    const v = view(["job_level_band", "active_employee_count"], rows);
    const a = answer(v);
    expect(cardTitle(a, v, titleOf)).toBe("active_employee_count · 按job_level_band");
    expect(headerSubtitle(a, v, titleOf)).toBeNull();
  });

  test("空结果仍由完整列角色识别指标，不依赖数据嗅探", () => {
    const v = view(["job_level_band", "active_employee_count"], []);
    expect(headerSubtitle(answer(v, "Aurora Labs 各职级人员结构"), v, titleOf)).toBe(
      "active_employee_count",
    );
  });

  test("不同粒度拆成独立分析，各自派生结构式副标题", () => {
    const yearly = view(
      ["year", "ytd_primary_event_rate"],
      [
        [2024, 3.1],
        [2025, 2.8],
      ],
    );
    const monthly = view(
      ["year", "month", "ytd_primary_event_rate"],
      [
        [2026, 1, 0.3],
        [2026, 2, 0.6],
      ],
    );
    expect(headerSubtitle(answer(yearly, "离职率年度对比"), yearly, titleOf)).toBe(
      "ytd_primary_event_rate · 年度趋势",
    );
    expect(headerSubtitle(answer(monthly, "离职率逐月趋势"), monthly, titleOf)).toBe(
      "ytd_primary_event_rate · 月度趋势",
    );
  });
});
