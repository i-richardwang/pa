import { describe, expect, test } from "bun:test";
import { sortByValueOrder } from "./value_order.js";
type CubeQuery = import("../ports/cube_gateway.js").CubeQuery;

const LEVEL = "test_people_metrics.job_level_band";
const CAMPUS = "test_people_metrics.is_campus";
const ORG = "test_people_metrics.org_1";
const HC = "test_people_metrics.active_employee_count";
const ORDER = new Map([[LEVEL, ["Band D", "Band C", "Band B", "Band A"]]]);

const q = (dimensions: string[], order?: CubeQuery["order"]): CubeQuery => ({
  measures: [HC],
  dimensions,
  ...(order ? { order } : {}),
});

const levels = (rows: Record<string, unknown>[]) => rows.map((r) => r[LEVEL]);

describe("sortByValueOrder", () => {
  test("声明了取值顺序的维度按声明顺序排列", () => {
    const data = [
      { [LEVEL]: "Band A", [HC]: 3 },
      { [LEVEL]: "Band D", [HC]: 1 },
      { [LEVEL]: "Band B", [HC]: 2 },
    ];
    expect(levels(sortByValueOrder(data, q([LEVEL]), ORDER))).toEqual([
      "Band D",
      "Band B",
      "Band A",
    ]);
  });

  test("查询显式 order 时不覆盖", () => {
    const data = [
      { [LEVEL]: "Band A", [HC]: 3 },
      { [LEVEL]: "Band D", [HC]: 1 },
    ];
    const r = sortByValueOrder(data, q([LEVEL], [[HC, "desc"]]), ORDER);
    expect(levels(r)).toEqual(["Band A", "Band D"]);
  });

  test("未声明的取值排在已声明取值之后，按首次出现的顺序", () => {
    const data = [
      { [LEVEL]: "其他", [HC]: 9 },
      { [LEVEL]: "Band B", [HC]: 2 },
      { [LEVEL]: "未分类", [HC]: 1 },
    ];
    expect(levels(sortByValueOrder(data, q([LEVEL]), ORDER))).toEqual(["Band B", "其他", "未分类"]);
  });

  test("排在前面的未声明维度保持引擎返回的顺序，声明了顺序的维度在组内按声明排列", () => {
    const data = [
      { [ORG]: "乙组织", [LEVEL]: "Band B", [HC]: 1 },
      { [ORG]: "乙组织", [LEVEL]: "Band C", [HC]: 2 },
      { [ORG]: "甲组织", [LEVEL]: "Band A", [HC]: 3 },
      { [ORG]: "甲组织", [LEVEL]: "Band D", [HC]: 4 },
    ];
    const r = sortByValueOrder(data, q([ORG, LEVEL]), ORDER);
    expect(r.map((x) => [x[ORG], x[LEVEL]])).toEqual([
      ["乙组织", "Band C"],
      ["乙组织", "Band B"],
      ["甲组织", "Band D"],
      ["甲组织", "Band A"],
    ]);
  });

  test("声明了顺序的维度排在前面时作为主排序，后面的维度保持稳定", () => {
    const data = [
      { [LEVEL]: "Band B", [CAMPUS]: "社招", [HC]: 1 },
      { [LEVEL]: "Band C", [CAMPUS]: "校招", [HC]: 2 },
      { [LEVEL]: "Band B", [CAMPUS]: "校招", [HC]: 3 },
      { [LEVEL]: "Band C", [CAMPUS]: "社招", [HC]: 4 },
    ];
    // 次级维度按取值首现序（社招首现于第一行）：各职级组内顺序一致
    const r = sortByValueOrder(data, q([LEVEL, CAMPUS]), ORDER);
    expect(r.map((x) => [x[LEVEL], x[CAMPUS]])).toEqual([
      ["Band C", "社招"],
      ["Band C", "校招"],
      ["Band B", "社招"],
      ["Band B", "校招"],
    ]);
  });

  test("无声明维度或空结果时原样返回", () => {
    expect(sortByValueOrder([], q([LEVEL]), ORDER)).toEqual([]);
    const data = [
      { [ORG]: "乙", [HC]: 1 },
      { [ORG]: "甲", [HC]: 2 },
    ];
    expect(sortByValueOrder(data, q([ORG]), ORDER)).toEqual(data);
  });
});
