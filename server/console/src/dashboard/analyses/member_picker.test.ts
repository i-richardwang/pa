import { describe, expect, test } from "bun:test";
import type { CatalogMemberPayload, MetricDomainPayload } from "@contract";
import { TIME_INTENT_INPUT, compileTimeIntent, resolveTimeOutputGrain } from "@time";
import { parseAnalysisSpec } from "../../../../src/semantic_core/analysis_spec";
import { groupMembers, metricDomainTitles, pickableMembers } from "./member_picker";
import { defaultTimeForWindow, withCurrent } from "./time_editor";

const measure: CatalogMemberPayload = {
  id: "measure:period_end_target_count",
  kind: "measure",
  title: "期末目标数",
  description: "期末配置的目标数量。",
  incompatible_dimensions: ["dimension:department_name"],
};
const dimension: CatalogMemberPayload = {
  id: "dimension:department_name",
  kind: "dimension",
  title: "部门",
  description: "部门名称。",
  dimension_group: { id: "organization", title: "组织与部门" },
};

describe("report editor member and time controls", () => {
  test("候选本地灰化只据纯语义信号：互斥维度与被封锁维度，双向置灰", () => {
    // 指标声明与某维度互斥：该维度被选中时指标置灰
    expect(pickableMembers([measure], ["dimension:department_name"], [])[0]).toMatchObject({
      canonical_name: measure.id,
      incompatible: true,
    });
    // 维度被选中指标封锁（blockedDimensions）时置灰
    expect(pickableMembers([dimension], [], ["dimension:department_name"])[0]).toMatchObject({
      canonical_name: dimension.id,
      incompatible: true,
    });
    // 无冲突信号时可选——跨来源可行性交由提交时的服务端预览编译裁定
    expect(pickableMembers([dimension], [], [])[0].incompatible).toBe(false);
  });

  // 分节靠服务端当前语义包投影的业务属性组驱动，身份使用公共语义 id：
  // JSON 形状或归组口径一旦漂移，这条必须炸，而不是静默退回一个「其他」大桶。
  test("维度按业务属性组分节，事实属性组优先于所属 cube 兜底", () => {
    const dimension = (id: string, title: string): CatalogMemberPayload => ({
      id,
      kind: "dimension",
      title,
      description: "",
      ...(id === "dimension:job_level_band"
        ? { dimension_group: { id: "job_and_level", title: "岗位与职级" } }
        : id === "dimension:gender"
          ? { dimension_group: { id: "employee_basic_info", title: "员工基本信息" } }
          : id === "dimension:organization_name"
            ? { dimension_group: { id: "organization", title: "组织与部门" } }
            : id === "dimension:leave_type"
              ? { dimension_group: { id: "termination_event", title: "离职记录属性" } }
              : {}),
    });
    const grouped = groupMembers(
      pickableMembers(
        [
          dimension("dimension:job_level_band", "职级段"),
          dimension("dimension:gender", "性别"),
          dimension("dimension:organization_name", "组织"),
          dimension("dimension:leave_type", "离职性质"),
          measure,
        ],
        [],
        [],
      ),
    );
    // 组序取成员首次出现；同组成员并节而非各自成节。
    // 没给指标域时指标不分节，落兜底桶且恒在末位
    expect(grouped.map((group) => group.label)).toEqual([
      "岗位与职级",
      "员工基本信息",
      "组织与部门",
      "离职记录属性",
      "其他",
    ]);
    expect(grouped[0].items.map((item) => item.id)).toEqual(["dimension:job_level_band"]);
    // 归不进任何组的维度才落末位兜底桶——模型归组是 fail-closed 的，真成员不该走到这里。
    expect(
      groupMembers(pickableMembers([dimension("dimension:nowhere", "无归属")], [], [])),
    ).toEqual([{ label: "其他", items: expect.any(Array) }]);
  });

  test("指标按指标域分节只为找得到：组序取目录里域的次序，一指标多域取先出现的域", () => {
    const m = (id: string, title: string): CatalogMemberPayload => ({
      id,
      kind: "measure",
      title,
      description: "",
    });
    const domain = (id: string, title: string, measure_ids: string[]): MetricDomainPayload => ({
      id: id as MetricDomainPayload["id"],
      title,
      synonyms: [],
      measure_ids,
      dimension_ids: [],
    });
    const domains = [
      domain("metric_domain:workforce_structure", "人员规模与结构", ["measure:headcount"]),
      domain("metric_domain:workforce_movement", "人员流动", [
        "measure:turnover",
        "measure:headcount",
      ]),
      domain("metric_domain:headcount_plan", "编制计划与完成", ["measure:fulfillment"]),
    ];
    const grouped = groupMembers(
      pickableMembers(
        [
          m("measure:fulfillment", "编制完成率"),
          m("measure:turnover", "离职人数"),
          m("measure:orphan", "无域指标"),
          m("measure:headcount", "在职人数"),
          dimension,
        ],
        [],
        [],
      ),
      metricDomainTitles(domains),
    );
    expect(grouped.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ["人员规模与结构", ["measure:headcount"]],
      ["人员流动", ["measure:turnover"]],
      ["编制计划与完成", ["measure:fulfillment"]],
      ["组织与部门", ["dimension:department_name"]],
      ["其他", ["measure:orphan"]],
    ]);
  });

  test("三个窗口默认态产生的业务坐标都能组成权威 AnalysisSpec", () => {
    for (const kind of ["current", "monthly", "yearly"] as const) {
      expect(() =>
        parseAnalysisSpec({
          views: [
            {
              id: "result",
              measures: ["test_people_metrics.active_employee_count"],
              time: compileTimeIntent(defaultTimeForWindow(kind)),
            },
          ],
        }),
      ).not.toThrow();
    }
  });

  // 编辑器只该产出契约合法、结果桶互不重叠的时间坐标。三个窗口默认态覆盖 GUI 的全部出口，
  // 逐个跑契约校验与唯一编译点的结果粒度解析，锁死「不生产会撞桶/非法坐标」这条不变量。
  test("三个窗口默认态都通过契约校验并解析出预期结果粒度", () => {
    const current = defaultTimeForWindow("current");
    const monthly = defaultTimeForWindow("monthly");
    const yearly = defaultTimeForWindow("yearly");
    for (const time of [current, monthly, yearly])
      expect(() => TIME_INTENT_INPUT.parse(time)).not.toThrow();
    expect(resolveTimeOutputGrain(compileTimeIntent(current), "2026-07")).toBe("total");
    expect(resolveTimeOutputGrain(compileTimeIntent(monthly), "2026-07")).toBe("month");
    expect(resolveTimeOutputGrain(compileTimeIntent(yearly), "2026-07")).toBe("year");
  });

  test("off-menu 的近 N 值注入档位列表，触发器不留空白且档位内不重复", () => {
    // agent 写的 last:{months:9}/years:7 不在预设档位，须补进列表头供触发器匹配显示。
    expect(withCurrent([6, 12, 24, 36], 9)).toEqual([9, 6, 12, 24, 36]);
    expect(withCurrent([2, 3, 4, 5, 6], 7)).toEqual([7, 2, 3, 4, 5, 6]);
    // 档位内的值不重复注入。
    expect(withCurrent([6, 12, 24, 36], 12)).toEqual([6, 12, 24, 36]);
  });

  test("默认态一律省略锚点走相对窗口，随数据滚动而非冻结在编辑月", () => {
    // 月度趋势与历年默认都是相对窗口 last（无绝对 range），保存后不冻结。
    expect(defaultTimeForWindow("monthly")).toEqual({
      window: { kind: "trailing", count: 12, unit: "month" },
    });
    expect(defaultTimeForWindow("yearly")).toEqual({
      window: { kind: "trailing", count: 3, unit: "year" },
    });
    expect(defaultTimeForWindow("current")).toEqual({
      window: { kind: "current_month" },
    });
    // 同期口径与主窗口整体错开一年，随 actual_through 滚动。
    const aligned = {
      window: { kind: "year_to_date" as const },
      display: "year" as const,
      comparison: { kind: "previous_year" as const },
    };
    expect(() => TIME_INTENT_INPUT.parse(aligned)).not.toThrow();
    expect(resolveTimeOutputGrain(compileTimeIntent(aligned), "2026-07")).toBe("year");
  });
});
