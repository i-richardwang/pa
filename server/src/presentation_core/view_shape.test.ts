/** 表格重排与图表声明彼此独立；任何图表都必须由显式 ChartDecl 触发。 */
import { describe, expect, test } from "bun:test";
import type { ColumnFormat, ViewBlock } from "../semantic_core/query_payload.js";
import { type Cell, viewBlock } from "../test_support/view_block.js";
import {
  analyzeResultShape,
  canCompileKpi,
  compileChart,
  compileTableWithStatus,
  compileTotalBand,
  renderShapeOfView,
  sensibleForms,
  structureTitle,
} from "./view_shape.js";

const payload = viewBlock;

const titleOf = (column: string) => column;
const percent = (...columns: string[]): Record<string, ColumnFormat> =>
  Object.fromEntries(columns.map((column) => [column, "percent"]));
const DEFAULT_TABLE = { type: "table" as const, y: [] };
const headerPathsOf = (table: { columns: { headerPath: Array<{ label: string }> }[] }) =>
  table.columns.map((column) => column.headerPath.map((part) => part.label));

describe("analyzeResultShape", () => {
  test("只消费 column_roles，数值维度不被误判为指标", () => {
    const view = payload(
      ["category_level", "active_employee_count"],
      [
        [5, 10],
        [6, 20],
      ],
      { roles: { category_level: "dimension", active_employee_count: "measure" } },
    );
    const shape = analyzeResultShape(view);
    expect(shape.roles.catIdx).toEqual([0]);
    expect(shape.roles.measureIdx).toEqual([1]);
  });

  test("结构占比是辅助度量，不挤掉分子指标", () => {
    const view = payload(
      ["level", "active_employee_count", "active_employee_share"],
      [
        ["Band C", 60, 0.6],
        ["Band B", 40, 0.4],
      ],
      {
        formats: percent("active_employee_share"),
        shares: [{ measure: "active_employee_share", numerator: "active_employee_count" }],
      },
    );
    expect(analyzeResultShape(view).roles.measureIdx).toEqual([1]);
  });
});

describe("compileTableWithStatus", () => {
  test("年度 × 组织：默认布局把组织放行轴、年份与指标放列轴", () => {
    const view = payload(
      ["year", "organization_name", "active_employee_count"],
      [2024, 2025, 2026].flatMap((year) =>
        ["示例组织甲", "示例组织乙", "示例组织丙", "示例组织丁", "示例组织戊", "示例组织己"].map(
          (organization, index): Cell[] => [year, organization, 100 + index + year],
        ),
      ),
      {
        roles: {
          year: "time",
          organization_name: "dimension",
          active_employee_count: "measure",
        },
      },
    );
    const compiled = compileTableWithStatus(view, titleOf, {
      type: "table",
      y: [],
      tableColumns: [{ kind: "time", level: "bucket" }, { kind: "metrics" }],
    });
    expect(compiled.layout).toEqual({ state: "applied", leafColumns: 3 });
    expect(headerPathsOf(compiled.table)).toEqual([
      ["organization_name"],
      ["2024", "active_employee_count"],
      ["2025", "active_employee_count"],
      ["2026", "active_employee_count"],
    ]);
    expect(compiled.table.rows[0]).toEqual(["示例组织甲", 2124, 2125, 2126]);
  });

  test("组织层级保留多个行首列，年度仍横置", () => {
    const view = payload(
      ["organization_name", "department_name", "year", "active_employee_count"],
      [
        ["ROOT_A", "Org1", 2025, 10],
        ["ROOT_A", "Org1", 2026, 12],
        ["ROOT_B", "Org2", 2025, 20],
        ["ROOT_B", "Org2", 2026, 22],
      ],
      {
        roles: {
          organization_name: "dimension",
          department_name: "dimension",
          year: "time",
          active_employee_count: "measure",
        },
      },
    );
    const table = compileTableWithStatus(view, titleOf, {
      type: "table",
      y: [],
      tableColumns: [{ kind: "time", level: "bucket" }, { kind: "metrics" }],
    }).table;
    expect(headerPathsOf(table)).toEqual([
      ["organization_name"],
      ["department_name"],
      ["2025", "active_employee_count"],
      ["2026", "active_employee_count"],
    ]);
    expect(table.rows).toEqual([
      ["ROOT_A", "Org1", 10, 12],
      ["ROOT_B", "Org2", 20, 22],
    ]);
  });

  test("跨年月度序列按月份成行、年份成列", () => {
    const rows: Cell[][] = [2025, 2026].flatMap((year) =>
      [1, 2, 3]
        .filter((month) => !(year === 2026 && month === 3))
        .map((month): Cell[] => [year, month, year * 10 + month]),
    );
    const table = compileTableWithStatus(
      payload(["year", "month", "active_employee_count"], rows),
      titleOf,
      {
        type: "table",
        y: [],
        tableColumns: [{ kind: "time", level: "year" }, { kind: "metrics" }],
      },
    ).table;
    expect(headerPathsOf(table)).toEqual([
      ["month"],
      ["2025", "active_employee_count"],
      ["2026", "active_employee_count"],
    ]);
    expect(table.rows).toEqual([
      [1, 20251, 20261],
      [2, 20252, 20262],
      [3, 20253, null],
    ]);
  });

  test("结果带时间轴而声明只提到维度与指标：时间落行轴，不因坐标重复降级", () => {
    const view = payload(
      ["year", "organization_name", "active_employee_count", "ytd_voluntary_turnover_rate"],
      [2024, 2025, 2026].flatMap((year) =>
        ["甲", "乙"].map((organization, index): Cell[] => [
          year,
          organization,
          100 + index + year,
          0.1 + index / 100,
        ]),
      ),
      {
        roles: {
          year: "time",
          organization_name: "dimension",
          active_employee_count: "measure",
          ytd_voluntary_turnover_rate: "measure",
        },
      },
    );
    const compiled = compileTableWithStatus(view, titleOf, {
      type: "table",
      y: [],
      tableColumns: [{ kind: "field", column: "organization_name" }, { kind: "metrics" }],
    });
    expect(compiled.layout).toEqual({ state: "applied", leafColumns: 4 });
    expect(headerPathsOf(compiled.table)[0]).toEqual(["时间"]);
    expect(compiled.table.rows.map((row) => row[0])).toEqual(["2024", "2025", "2026"]);
  });

  test("缺省列轴：维度成行、指标与时间成列；结果无时间轴时只留指标", () => {
    const rows: Cell[][] = [2025, 2026].flatMap((year) =>
      ["甲", "乙"].map((organization): Cell[] => [year, organization, year]),
    );
    const temporal = payload(["year", "organization_name", "active_employee_count"], rows, {
      roles: {
        year: "time",
        organization_name: "dimension",
        active_employee_count: "measure",
      },
    });
    expect(headerPathsOf(compileTableWithStatus(temporal, titleOf, DEFAULT_TABLE).table)).toEqual([
      ["organization_name"],
      ["active_employee_count", "2025"],
      ["active_employee_count", "2026"],
    ]);
    const flat = payload(
      ["organization_name", "active_employee_count"],
      [
        ["甲", 10],
        ["乙", 20],
      ],
      { roles: { organization_name: "dimension", active_employee_count: "measure" } },
    );
    expect(headerPathsOf(compileTableWithStatus(flat, titleOf, DEFAULT_TABLE).table)).toEqual([
      ["organization_name"],
      ["active_employee_count"],
    ]);
  });

  test("声明的时间轴在结果里不存在：显式不可用并退回长表", () => {
    const flat = payload(
      ["organization_name", "active_employee_count"],
      [
        ["甲", 10],
        ["乙", 20],
      ],
      { roles: { organization_name: "dimension", active_employee_count: "measure" } },
    );
    const compiled = compileTableWithStatus(flat, titleOf, {
      type: "table",
      y: [],
      tableColumns: [{ kind: "metrics" }, { kind: "time", level: "bucket" }],
    });
    expect(compiled.layout).toMatchObject({ state: "unavailable", reason: "missing_axis" });
    expect(headerPathsOf(compiled.table)).toEqual([
      ["organization_name"],
      ["active_employee_count"],
    ]);
  });

  test("未声明列轴的双分类单度量保持两个行轴", () => {
    const table = compileTableWithStatus(
      payload(
        ["organization_name", "degree", "active_employee_count"],
        [
          ["A", "本科", 10],
          ["A", "硕士", 5],
          ["B", "本科", 20],
          ["B", "硕士", 8],
        ],
      ),
      titleOf,
    ).table;
    expect(headerPathsOf(table)).toEqual([
      ["organization_name"],
      ["degree"],
      ["active_employee_count"],
    ]);
    expect(table.rows).toEqual([
      ["A", "本科", 10],
      ["A", "硕士", 5],
      ["B", "本科", 20],
      ["B", "硕士", 8],
    ]);
  });

  test("显式业务维度列轴生效，单指标也保留指标层", () => {
    const view = payload(
      ["organization_name", "degree", "active_employee_count"],
      [
        ["A", "本科", 10],
        ["A", "硕士", 5],
        ["B", "本科", 20],
        ["B", "硕士", 8],
        ["C", "本科", 7],
        ["C", "硕士", 3],
      ],
      {
        roles: {
          organization_name: "dimension",
          degree: "dimension",
          active_employee_count: "measure",
        },
      },
    );
    const compiled = compileTableWithStatus(view, titleOf, {
      type: "table",
      y: [],
      tableColumns: [{ kind: "field", column: "organization_name" }, { kind: "metrics" }],
    });
    expect(compiled.layout).toEqual({ state: "applied", leafColumns: 3 });
    expect(headerPathsOf(compiled.table)).toEqual([
      ["degree"],
      ["A", "active_employee_count"],
      ["B", "active_employee_count"],
      ["C", "active_employee_count"],
    ]);
    expect(compiled.table.rows).toEqual([
      ["本科", 10, 20, 7],
      ["硕士", 5, 8, 3],
    ]);
    expect(compiled.table.sourceRows).toEqual([
      [null, 0, 2, 4],
      [null, 1, 3, 5],
    ]);
    expect(
      renderShapeOfView(view, {
        type: "table",
        y: [],
        tableColumns: [{ kind: "field", column: "organization_name" }, { kind: "metrics" }],
      }),
    ).toBe("crosstab");
  });

  test("年份作为列轴，指标作为内层列轴形成多层表头", () => {
    const compiled = compileTableWithStatus(
      payload(
        ["year", "organization_name", "active_employee_count", "active_employee_share"],
        [
          [2025, "A", 10, 0.4],
          [2026, "A", 12, 0.5],
          [2025, "B", 20, 0.6],
          [2026, "B", 22, 0.5],
        ],
        {
          formats: percent("active_employee_share"),
          shares: [{ measure: "active_employee_share", numerator: "active_employee_count" }],
          roles: {
            year: "time",
            organization_name: "dimension",
            active_employee_count: "measure",
            active_employee_share: "measure",
          },
        },
      ),
      titleOf,
      {
        type: "table",
        y: [],
        tableColumns: [{ kind: "time", level: "bucket" }, { kind: "metrics" }],
      },
    );
    expect(compiled.layout).toEqual({ state: "applied", leafColumns: 4 });
    expect(headerPathsOf(compiled.table)).toEqual([
      ["organization_name"],
      ["2025", "active_employee_count"],
      ["2025", "active_employee_share"],
      ["2026", "active_employee_count"],
      ["2026", "active_employee_share"],
    ]);
    expect(compiled.table.rows[0]).toEqual(["A", 10, 0.4, 12, 0.5]);
    expect(compiled.table.columns[2].format).toBe("percent");
  });

  test("列轴顺序决定表头层级顺序", () => {
    const view = payload(
      ["year", "organization_name", "active_employee_count", "new_hire_count"],
      [
        [2025, "A", 10, 2],
        [2026, "A", 12, 3],
      ],
      {
        roles: {
          year: "time",
          organization_name: "dimension",
          active_employee_count: "measure",
          new_hire_count: "measure",
        },
      },
    );
    const compiled = compileTableWithStatus(view, titleOf, {
      type: "table",
      y: [],
      tableColumns: [{ kind: "metrics" }, { kind: "time", level: "bucket" }],
    });
    expect(headerPathsOf(compiled.table)).toEqual([
      ["organization_name"],
      ["active_employee_count", "2025"],
      ["active_employee_count", "2026"],
      ["new_hire_count", "2025"],
      ["new_hire_count", "2026"],
    ]);
  });

  test("重复坐标显式不可用并忠实返回原始长表", () => {
    const duplicate = payload(
      ["organization_name", "degree", "active_employee_count"],
      [
        ["A", "本科", 10],
        ["A", "本科", 11],
        ["A", "硕士", 5],
        ["B", "本科", 20],
        ["B", "硕士", 8],
      ],
      {
        roles: {
          organization_name: "dimension",
          degree: "dimension",
          active_employee_count: "measure",
        },
      },
    );
    const duplicateCompilation = compileTableWithStatus(duplicate, titleOf, {
      type: "table",
      y: [],
      tableColumns: [{ kind: "field", column: "degree" }, { kind: "metrics" }],
    });
    expect(duplicateCompilation.layout).toMatchObject({
      state: "unavailable",
      reason: "duplicate_coordinate",
    });
    expect(duplicateCompilation.table.columns.map((column) => column.label)).toEqual([
      "organization_name",
      "degree",
      "active_employee_count",
    ]);
  });

  test("宽表与单值列轴都忠实生效", () => {
    const degrees = Array.from({ length: 25 }, (_, index) => `学历${index}`);
    const wide = payload(
      ["organization_name", "degree", "active_employee_count"],
      degrees.map((degree): Cell[] => ["A", degree, 10]),
      {
        roles: {
          organization_name: "dimension",
          degree: "dimension",
          active_employee_count: "measure",
        },
      },
    );
    const singleton = payload(
      ["organization_name", "degree", "active_employee_count"],
      [
        ["A", "本科", 10],
        ["B", "本科", 20],
      ],
      {
        roles: {
          organization_name: "dimension",
          degree: "dimension",
          active_employee_count: "measure",
        },
      },
    );
    const layout = [{ kind: "field" as const, column: "degree" }, { kind: "metrics" as const }];
    const wideCompilation = compileTableWithStatus(wide, titleOf, {
      type: "table",
      y: [],
      tableColumns: layout,
    });
    expect(wideCompilation.layout).toEqual({
      state: "applied",
      leafColumns: 25,
    });
    expect(wideCompilation.table.columns).toHaveLength(26);
    expect(
      compileTableWithStatus(singleton, titleOf, {
        type: "table",
        y: [],
        tableColumns: layout,
      }).layout,
    ).toEqual({ state: "applied", leafColumns: 1 });
  });

  test("超过资源上限显式不可用", () => {
    const degrees = Array.from({ length: 241 }, (_, index) => `学历${index}`);
    const view = payload(
      ["organization_name", "degree", "active_employee_count"],
      degrees.map((degree): Cell[] => ["A", degree, 10]),
      {
        roles: {
          organization_name: "dimension",
          degree: "dimension",
          active_employee_count: "measure",
        },
      },
    );
    const compiled = compileTableWithStatus(view, titleOf, {
      type: "table",
      y: [],
      tableColumns: [{ kind: "field", column: "degree" }, { kind: "metrics" }],
    });
    expect(compiled.layout).toMatchObject({
      state: "unavailable",
      reason: "resource_limit",
      leafColumns: 241,
    });
    expect(compiled.table.columns).toHaveLength(3);
  });

  test("模型重算总体映射到交叉表尾且不伪造明细来源", () => {
    const view = payload(
      ["organization_name", "year", "active_employee_count"],
      [
        ["A", 2025, 10],
        ["A", 2026, 12],
        ["B", 2025, 20],
        ["B", 2026, 22],
      ],
      {
        roles: {
          organization_name: "dimension",
          year: "time",
          active_employee_count: "measure",
        },
        summary: {
          kind: "grand_total",
          label: "总体",
          scope: "filtered_set",
          rows: [
            [null, 2025, 30],
            [null, 2026, 34],
          ],
        },
      },
    );
    const table = compileTableWithStatus(view, titleOf, {
      type: "table",
      y: [],
      tableColumns: [{ kind: "time", level: "bucket" }, { kind: "metrics" }],
    }).table;
    expect(table.summaryRows).toEqual([["总体", 30, 34]]);
    expect(table.sourceRows?.[0]).toEqual([null, 0, 1]);
  });
});

describe("compileChart", () => {
  test("折线只编译显式声明的指标并按时间升序", () => {
    const view = payload(
      ["year", "month", "new_hire_count", "leave_count"],
      [
        [2026, 2, 40, 15],
        [2026, 1, 30, 10],
      ],
    );
    const chart = compileChart(view, titleOf, { type: "line", y: ["new_hire_count"] });
    expect(chart?.kind).toBe("line");
    if (chart?.kind !== "line") return;
    expect(chart.rows.map((row) => row.t)).toEqual(["2026-01", "2026-02"]);
    expect(chart.series.map((series) => series.column)).toEqual(["new_hire_count"]);
  });

  test("时间 × 大基数分类的折线声明失败后不改选其他图表", () => {
    const organizations = ["A", "B", "C", "D", "E", "F"];
    const view = payload(
      ["year", "organization_name", "active_employee_count"],
      [2025, 2026].flatMap((year) =>
        organizations.map((organization, index): Cell[] => [year, organization, 10 + index]),
      ),
    );
    expect(
      compileChart(view, titleOf, {
        type: "line",
        y: ["active_employee_count"],
        groupBy: "organization_name",
      }),
    ).toBeNull();
    expect(
      headerPathsOf(
        compileTableWithStatus(view, titleOf, {
          type: "table",
          y: [],
          tableColumns: [{ kind: "time", level: "bucket" }, { kind: "metrics" }],
        }).table,
      ),
    ).toEqual([
      ["organization_name"],
      ["2025", "active_employee_count"],
      ["2026", "active_employee_count"],
    ]);
  });

  test("分类柱形、分组柱形和饼图只按各自声明编译", () => {
    const simple = payload(
      ["organization_name", "active_employee_count"],
      [
        ["A", 60],
        ["B", 40],
      ],
    );
    expect(
      compileChart(simple, titleOf, {
        type: "bar",
        x: "organization_name",
        y: ["active_employee_count"],
      })?.kind,
    ).toBe("bar");
    expect(
      compileChart(simple, titleOf, {
        type: "pie",
        x: "organization_name",
        y: ["active_employee_count"],
      })?.kind,
    ).toBe("pie");

    const grouped = payload(
      ["organization_name", "degree", "active_employee_count"],
      [
        ["A", "本科", 10],
        ["A", "硕士", 5],
        ["B", "本科", 20],
        ["B", "硕士", 8],
      ],
    );
    const chart = compileChart(grouped, titleOf, {
      type: "bar",
      x: "organization_name",
      y: ["active_employee_count"],
      groupBy: "degree",
      stack: true,
    });
    expect(chart).toMatchObject({ kind: "bar", stacked: true });
  });

  test("空维度值出占位名，不是一个没有名字的切片", () => {
    const roles = {
      previous_category_type: "dimension",
      active_employee_count: "measure",
    } as const;
    const view = payload(
      ["previous_category_type", "active_employee_count"],
      [
        ["类别甲", 60],
        ["", 32],
        ["类别乙", 8],
      ],
      { roles },
    );
    const chart = compileChart(view, titleOf, {
      type: "pie",
      x: "previous_category_type",
      y: ["active_employee_count"],
    });
    expect((chart as { rows: { label: string; value: number | null }[] }).rows).toEqual([
      { label: "类别甲", value: 60 },
      { label: "—", value: 32 },
      { label: "类别乙", value: 8 },
    ]);

    const both = payload(
      ["previous_category_type", "active_employee_count"],
      [
        ["类别甲", 60],
        ["", 32],
        [null, 8],
      ],
      { roles },
    );
    expect(
      compileChart(both, titleOf, {
        type: "pie",
        x: "previous_category_type",
        y: ["active_employee_count"],
      }),
    ).toBeNull();
  });

  test("率指标不能编译为饼图", () => {
    const view = payload(
      ["organization_name", "turnover_rate"],
      [
        ["A", 0.01],
        ["B", 0.02],
      ],
      { formats: percent("turnover_rate") },
    );
    expect(
      compileChart(view, titleOf, {
        type: "pie",
        x: "organization_name",
        y: ["turnover_rate"],
      }),
    ).toBeNull();
  });
});

describe("显式呈现能力与形态标签", () => {
  test("KPI 只接受单行纯度量，且必须显式声明才成为 KPI", () => {
    const view = payload(["active_employee_count"], [[12345]]);
    expect(canCompileKpi(view)).toBe(true);
    expect(sensibleForms(view)).toEqual(["table", "kpi"]);
    expect(renderShapeOfView(view, { type: "table", y: [] })).toBe("table");
    expect(renderShapeOfView(view, { type: "kpi", y: [] })).toBe("kpi");
  });

  test("推荐候选不拥有执行权：同一结果按声明分别得到表格或柱图", () => {
    const view = payload(
      ["organization_name", "active_employee_count"],
      [
        ["A", 10],
        ["B", 20],
      ],
    );
    expect(sensibleForms(view)).toEqual(["table", "bar", "pie"]);
    expect(renderShapeOfView(view, { type: "table", y: [] })).toBe("table");
    expect(
      renderShapeOfView(view, {
        type: "bar",
        x: "organization_name",
        y: ["active_employee_count"],
      }),
    ).toBe("bar");
  });

  test("空结果无运行时形态，声明仍由规格保留", () => {
    expect(
      renderShapeOfView(payload(["active_employee_count"], []), {
        type: "kpi",
        y: [],
      }),
    ).toBeNull();
  });
});

describe("对照期呈现", () => {
  const monthly = (
    coordinates: { role: "primary" | "comparison"; from: string; to: string }[],
    rows: Cell[][],
    formats?: Record<string, ColumnFormat>,
  ): ViewBlock => ({
    ...payload(["year", "month", "turnover_rate"], rows, formats ? { formats } : {}),
    time: {
      grain: "month",
      coordinates,
      buckets: coordinates.flatMap((coordinate) =>
        rows
          .filter(
            (row) =>
              `${row[0]}-${String(row[1]).padStart(2, "0")}` >= coordinate.from &&
              `${row[0]}-${String(row[1]).padStart(2, "0")}` <= coordinate.to,
          )
          .map((row) => {
            const month = `${row[0]}-${String(row[1]).padStart(2, "0")}`;
            return { key: { year: Number(row[0]), month: Number(row[1]) }, from: month, to: month };
          }),
      ),
    },
  });

  const YEAR_OVER_YEAR = [
    { role: "primary" as const, from: "2026-01", to: "2026-03" },
    { role: "comparison" as const, from: "2025-01", to: "2025-03" },
  ];
  const ROWS: Cell[][] = [
    [2025, 1, 0.01],
    [2025, 2, 0.02],
    [2025, 3, 0.03],
    [2026, 1, 0.04],
    [2026, 2, 0.05],
    [2026, 3, 0.06],
  ];

  test("往年同期叠加成期间系列，横轴取主期位置", () => {
    const chart = compileChart(monthly(YEAR_OVER_YEAR, ROWS), titleOf, {
      type: "line",
      y: ["turnover_rate"],
    });
    if (!chart || !("series" in chart)) throw new Error("应编译出折线");
    expect(chart.series.map((item) => item.name)).toEqual(["2026年", "2025年"]);
    expect(chart.rows.map((row) => row.t)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(chart.rows[0]).toMatchObject({ s0: 0.04, s1: 0.01 });
    expect(chart.rows[2]).toMatchObject({ s0: 0.06, s1: 0.03 });
  });

  test("相邻周期对照不叠加，仍是一条连续时间轴", () => {
    const adjacent = [
      { role: "primary" as const, from: "2026-01", to: "2026-03" },
      { role: "comparison" as const, from: "2025-10", to: "2025-12" },
    ];
    const rows: Cell[][] = [
      [2025, 10, 0.01],
      [2025, 11, 0.02],
      [2025, 12, 0.03],
      [2026, 1, 0.04],
      [2026, 2, 0.05],
      [2026, 3, 0.06],
    ];
    const chart = compileChart(monthly(adjacent, rows), titleOf, {
      type: "line",
      y: ["turnover_rate"],
    });
    if (!chart || !("series" in chart)) throw new Error("应编译出折线");
    expect(chart.series).toHaveLength(1);
    expect(chart.rows).toHaveLength(6);
  });

  test("单一期间零变化：仍是单系列时间轴", () => {
    const single = [{ role: "primary" as const, from: "2026-01", to: "2026-03" }];
    const chart = compileChart(monthly(single, ROWS.slice(3)), titleOf, {
      type: "line",
      y: ["turnover_rate"],
    });
    if (!chart || !("series" in chart)) throw new Error("应编译出折线");
    expect(chart.series).toHaveLength(1);
    expect(chart.rows.map((row) => row.t)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  const yearly = (measure: string, formats?: Record<string, ColumnFormat>): ViewBlock => ({
    ...payload(
      ["year", measure],
      [
        [2025, measure === "turnover_rate" ? 0.1 : 100],
        [2026, measure === "turnover_rate" ? 0.13 : 125],
      ],
      formats ? { formats } : {},
    ),
    time: {
      grain: "year",
      coordinates: [
        { role: "primary", from: "2026-01", to: "2026-12" },
        { role: "comparison", from: "2025-01", to: "2025-12" },
      ],
      buckets: [
        { key: { year: 2026 }, from: "2026-01", to: "2026-12" },
        { key: { year: 2025 }, from: "2025-01", to: "2025-12" },
      ],
    },
  });
  const yearLayout = {
    type: "table" as const,
    y: [],
    tableColumns: [{ kind: "metrics" as const }, { kind: "time" as const, level: "year" as const }],
  };

  test("率指标的对照差值按百分点派生，紧随对照列且不参与下钻", () => {
    const compiled = compileTableWithStatus(
      yearly("turnover_rate", { turnover_rate: "percent" }),
      titleOf,
      yearLayout,
    );
    expect(compiled.table.columns.map((column) => column.label)).toEqual([
      "2025",
      "2026",
      "较2025年",
    ]);
    expect(compiled.table.columns[2].format).toBe("percentage_point");
    // 浮点按同尺度比较。
    expect(Number(compiled.table.rows[0][2])).toBeCloseTo(0.03, 10);
    expect(compiled.table.sourceRows?.[0][2]).toBeNull();
    expect(compiled.layout).toEqual({ state: "applied", leafColumns: 3 });
  });

  test("bucket 级时间列轴逐桶成列，期间与列值非一一对应：不派生差值", () => {
    const bucketLayout = {
      type: "table" as const,
      y: [],
      tableColumns: [
        { kind: "metrics" as const },
        { kind: "time" as const, level: "bucket" as const },
      ],
    };
    const compiled = compileTableWithStatus(
      monthly(YEAR_OVER_YEAR, ROWS, { turnover_rate: "percent" }),
      titleOf,
      bucketLayout,
    );
    expect(compiled.table.columns).toHaveLength(6);
    expect(compiled.table.columns.some((column) => column.label.startsWith("较"))).toBe(false);
  });

  test("百分点格式的源指标属率族：差值仍按百分点作差", () => {
    const compiled = compileTableWithStatus(
      yearly("turnover_rate", { turnover_rate: "percentage_point" }),
      titleOf,
      yearLayout,
    );
    expect(compiled.table.columns[2].format).toBe("percentage_point");
    expect(Number(compiled.table.rows[0][2])).toBeCloseTo(0.03, 10);
  });

  test("量指标的对照差值是相对变化率，分母为零时无定义", () => {
    const compiled = compileTableWithStatus(yearly("turnover_count"), titleOf, yearLayout);
    expect(compiled.table.columns[2].format).toBe("percent");
    expect(Number(compiled.table.rows[0][2])).toBeCloseTo(0.25, 10);

    const zeroBase = yearly("turnover_count");
    zeroBase.rows = [
      [2025, 0],
      [2026, 12],
    ];
    expect(compileTableWithStatus(zeroBase, titleOf, yearLayout).table.rows[0][2]).toBeNull();
  });

  test("无对照期的结果不生成差值列", () => {
    const single = yearly("turnover_rate", { turnover_rate: "percent" });
    single.time = {
      grain: "year",
      coordinates: [{ role: "primary", from: "2025-01", to: "2026-12" }],
      buckets: single.time!.buckets,
    };
    const compiled = compileTableWithStatus(single, titleOf, yearLayout);
    expect(compiled.table.columns.map((column) => column.label)).toEqual(["2025", "2026"]);
    expect(compiled.layout).toEqual({ state: "applied", leafColumns: 2 });
  });
});

/** 两种载体（桶键数字 / 结果行字符串）各断言一次。 */
describe("月×年交叉表的时间键归一", () => {
  const crosstab = {
    type: "table" as const,
    y: [],
    tableColumns: [{ kind: "metrics" as const }, { kind: "time" as const, level: "year" as const }],
  };
  const trailing = (rows: Cell[][]): ViewBlock => ({
    ...payload(["year", "month", "active_employee_count"], rows),
    time: {
      grain: "month",
      coordinates: [{ role: "primary", from: "2025-11", to: "2026-01" }],
      buckets: [
        { key: { year: 2025, month: 11 }, from: "2025-11", to: "2025-11" },
        { key: { year: 2025, month: 12 }, from: "2025-12", to: "2025-12" },
        { key: { year: 2026, month: 1 }, from: "2026-01", to: "2026-01" },
      ],
    },
  });

  test.each([
    ["字符串年月（执行层实际形态）", ["2025", "2025", "2026"], ["11", "12", "1"]],
    ["数字年月", [2025, 2025, 2026], [11, 12, 1]],
  ])("%s 都能落进跨年的月×年矩阵", (_label, years, months) => {
    const compiled = compileTableWithStatus(
      trailing(years.map((year, index) => [year, months[index], 100 + index])),
      titleOf,
      crosstab,
    );
    expect(compiled.table.columns.map((column) => column.label)).toEqual(["month", "2025", "2026"]);
    // 行头保持结果自身的载体类型，故按字面量比较。
    expect(compiled.table.rows.map(([month, ...values]) => [String(month), ...values])).toEqual([
      ["11", 100, null],
      ["12", 101, null],
      ["1", null, 102],
    ]);
    expect(compiled.layout).toEqual({ state: "applied", leafColumns: 2 });
  });
});

describe("整窗读数", () => {
  const withTotals = (
    coordinates: { role: "primary" | "comparison"; from: string; to: string }[],
    totals: NonNullable<ViewBlock["totals"]>,
    formats?: Record<string, ColumnFormat>,
  ): ViewBlock => ({
    ...payload(
      ["year", "month", "turnover_count", "turnover_rate"],
      [
        [2026, 1, 10, 0.01],
        [2026, 2, 12, 0.02],
      ],
      formats ? { formats } : {},
    ),
    time: {
      grain: "month",
      coordinates,
      buckets: [
        { key: { year: 2026, month: 1 }, from: "2026-01", to: "2026-01" },
        { key: { year: 2026, month: 2 }, from: "2026-02", to: "2026-02" },
      ],
    },
    totals,
  });

  const PRIMARY_ONLY = [{ role: "primary" as const, from: "2026-01", to: "2026-02" }];

  test("整窗合计成位，覆盖期间写实到月", () => {
    const band = compileTotalBand(
      withTotals(PRIMARY_ONLY, {
        metrics: [
          {
            column: "turnover_count",
            periods: [{ from: "2026-01", to: "2026-02", value: 22, coverage: "window" }],
          },
        ],
      }),
      titleOf,
    );
    expect(band?.metrics).toEqual([
      {
        column: "turnover_count",
        label: "turnover_count",
        value: 22,
        format: "number",
        period: { label: "2026年1—2月", from: "2026-01", to: "2026-02" },
        comparisons: [],
      },
    ]);
  });

  test("终点降级的指标副标写它真正盖住的期间，而不是所选窗口", () => {
    const band = compileTotalBand(
      {
        ...withTotals([{ role: "primary", from: "2025-06", to: "2026-08" }], {
          metrics: [
            {
              column: "turnover_rate",
              periods: [{ from: "2026-01", to: "2026-08", value: 0.08, coverage: "endpoint" }],
            },
          ],
        }),
      },
      titleOf,
    );
    // 副标与下钻坐标同源：label 是读法，from/to 是身份，两者必须指同一段。
    expect(band?.metrics[0].period).toEqual({
      label: "2026年1—8月",
      from: "2026-01",
      to: "2026-08",
    });
  });

  test("差值走与表格差值列同一算术：率得百分点，量得相对变化率", () => {
    const coordinates = [
      { role: "primary" as const, from: "2026-01", to: "2026-02" },
      { role: "comparison" as const, from: "2025-01", to: "2025-02" },
    ];
    const band = compileTotalBand(
      withTotals(
        coordinates,
        {
          metrics: [
            {
              column: "turnover_count",
              periods: [
                { from: "2026-01", to: "2026-02", value: 22, coverage: "window" },
                { from: "2025-01", to: "2025-02", value: 20, coverage: "window" },
              ],
            },
            {
              column: "turnover_rate",
              periods: [
                { from: "2026-01", to: "2026-02", value: 0.05, coverage: "window" },
                { from: "2025-01", to: "2025-02", value: 0.03, coverage: "window" },
              ],
            },
          ],
        },
        percent("turnover_rate"),
      ),
      titleOf,
    );
    expect(band?.metrics[0].comparisons).toEqual([
      { label: "较2025年", value: (22 - 20) / 20, format: "percent" },
    ]);
    const rate = band?.metrics[1].comparisons[0];
    expect(rate?.format).toBe("percentage_point");
    expect(rate?.value).toBeCloseTo(0.02, 10);
  });

  test("派生结果没有合计供给，收敛为单行纯指标时那一行即整窗单值", () => {
    const derived = payload(["double_headcount"], [[24]]);
    expect(compileTotalBand(derived, titleOf)).toEqual({
      metrics: [
        {
          column: "double_headcount",
          label: "double_headcount",
          value: 24,
          format: "number",
          comparisons: [],
        },
      ],
    });
    expect(compileTotalBand(payload(["active_employee_count"], [[1], [2]]), titleOf)).toBeNull();
  });

  test("时间序列可成指标卡，带业务分组则不可", () => {
    const series = withTotals(PRIMARY_ONLY, {
      metrics: [
        {
          column: "turnover_count",
          periods: [{ from: "2026-01", to: "2026-02", value: 22, coverage: "window" }],
        },
      ],
    });
    expect(canCompileKpi(series)).toBe(true);
    const grouped: ViewBlock = {
      ...series,
      columns: [...series.columns, "organization_name"],
      column_roles: { ...series.column_roles, organization_name: "dimension" },
      rows: series.rows.map((row) => [...row, "研发"]),
    };
    expect(canCompileKpi(grouped)).toBe(false);
  });
});

describe("列声明的小数位随列走", () => {
  test("表格列、差值列与整窗读数都带上 column_decimals；未声明的列不带", () => {
    const view = payload(
      ["year", "organization_name", "survey_score", "active_employee_count"],
      [
        [2025, "研发", 0.21, 100],
        [2026, "研发", 0.2349, 120],
      ],
      {
        roles: {
          year: "time",
          organization_name: "dimension",
          survey_score: "measure",
          active_employee_count: "measure",
        },
        formats: percent("survey_score"),
        decimals: { survey_score: 0 },
      },
    );
    const table = compileTableWithStatus(view, titleOf, {
      type: "table",
      y: [],
      tableColumns: [{ kind: "field", column: "year" }, { kind: "metrics" }],
    }).table;
    const surveyColumns = table.columns.filter((column) => column.formatKey === "survey_score");
    expect(surveyColumns.length).toBeGreaterThan(0);
    expect(surveyColumns.every((column) => column.decimals === 0)).toBe(true);
    expect(
      table.columns
        .filter((column) => column.formatKey === "active_employee_count")
        .every((column) => column.decimals === undefined),
    ).toBe(true);

    const flat = compileTableWithStatus(view, titleOf, undefined).table;
    expect(flat.columns.find((column) => column.formatKey === "survey_score")?.decimals).toBe(0);

    const band = compileTotalBand(
      {
        ...view,
        columns: ["survey_score", "active_employee_count"],
        column_roles: { survey_score: "measure", active_employee_count: "measure" },
        column_formats: percent("survey_score"),
        column_decimals: { survey_score: 0 },
        rows: [[0.2349, 120]],
      } as ViewBlock,
      titleOf,
    );
    expect(band?.metrics.map((metric) => metric.decimals)).toEqual([0, undefined]);
  });
});

describe("structureTitle：度量 · 按分类 · 趋势粒度", () => {
  const roles = (columns: string[]) =>
    Object.fromEntries(
      columns.map((column) => [
        column,
        column === "year" || column === "month"
          ? "time"
          : column === "organization_name" || column === "job_level_band"
            ? "dimension"
            : "measure",
      ]),
    ) as ViewBlock["column_roles"];
  const view = (columns: string[], rows: Cell[][], shares?: ViewBlock["structure_shares"]) =>
    payload(columns, rows, { roles: roles(columns), shares });

  test("与分子同查的占比列不进标题（它是分子度量的注释）", () => {
    const v = view(
      ["job_level_band", "active_employee_count", "active_employee_share"],
      [["Band B", 40, 0.4]],
      [{ measure: "active_employee_share", numerator: "active_employee_count" }],
    );
    expect(structureTitle(v, titleOf)).toBe("active_employee_count");
  });

  test("单独查询的占比列照常进标题（无分子可注释）", () => {
    const v = view(["job_level_band", "active_employee_share"], [["Band B", 40]]);
    expect(structureTitle(v, titleOf)).toBe("active_employee_share");
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
    expect(structureTitle(v, titleOf)).toBe("hires、leavers");
  });

  test("多取值分类维度进标题；取值唯一的分类列是过滤回显，不进标题", () => {
    expect(
      structureTitle(
        view(
          ["job_level_band", "active_employee_count"],
          [
            ["Band B", 40],
            ["Band C", 30],
          ],
        ),
        titleOf,
      ),
    ).toBe("active_employee_count · 按job_level_band");
    expect(
      structureTitle(
        view(
          ["organization_name", "job_level_band", "active_employee_count"],
          [
            ["Aurora Labs", "Band B", 40],
            ["Aurora Labs", "Band C", 30],
          ],
        ),
        titleOf,
      ),
    ).toBe("active_employee_count · 按job_level_band");
  });

  test("双分类维度以 × 连接", () => {
    const v = view(
      ["organization_name", "job_level_band", "active_employee_count"],
      [
        ["A", "Band B", 40],
        ["B", "Band C", 30],
      ],
    );
    expect(structureTitle(v, titleOf)).toBe(
      "active_employee_count · 按organization_name × job_level_band",
    );
  });

  test("超过三个度量以「等」收束", () => {
    const v = view(["a", "b", "c", "d"], [[1, 2, 3, 4]]);
    expect(structureTitle(v, titleOf)).toBe("a、b、c 等");
  });

  test("多时点才算趋势：带 month 列即月度、否则年度；单时点是过滤回显", () => {
    expect(
      structureTitle(
        view(
          ["year", "active_employee_count"],
          [
            [2024, 100],
            [2025, 110],
          ],
        ),
        titleOf,
      ),
    ).toBe("active_employee_count · 年度趋势");
    expect(
      structureTitle(
        view(
          ["year", "month", "active_employee_count"],
          [
            [2026, 1, 100],
            [2026, 2, 110],
          ],
        ),
        titleOf,
      ),
    ).toBe("active_employee_count · 月度趋势");
    expect(
      structureTitle(
        view(
          ["year", "job_level_band", "active_employee_count"],
          [
            [2026, "Band B", 40],
            [2026, "Band C", 30],
          ],
        ),
        titleOf,
      ),
    ).toBe("active_employee_count · 按job_level_band");
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
    expect(structureTitle(v, titleOf)).toBe("active_employee_count · 按job_level_band · 年度趋势");
  });

  test("空结果仍由完整列角色识别指标，不依赖数据嗅探", () => {
    expect(structureTitle(view(["job_level_band", "active_employee_count"], []), titleOf)).toBe(
      "active_employee_count",
    );
  });

  test("没有度量时只列分类；什么都派生不出时为 null", () => {
    expect(structureTitle(view(["job_level_band"], [["Band B"], ["Band C"]]), titleOf)).toBe(
      "job_level_band",
    );
    expect(structureTitle(view(["job_level_band"], [["Band B"]]), titleOf)).toBeNull();
  });
});
