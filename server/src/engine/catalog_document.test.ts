/**
 * CatalogDocument 守护：单一装配、跨视图归并、MCP 投影与人类消费面字段白名单。
 * 规范同名身份归并由两个测试主题共用的 active_employee_count 与组织维度承载。
 */
import { describe, expect, test } from "bun:test";
import {
  browseCatalogDocument,
  buildCatalogDocument as buildRawCatalogDocument,
  canonicalCatalog,
  searchCatalogDocument,
  toCompilerCatalog,
  toSemanticCatalog,
  type CatalogDocument,
} from "./catalog_document.js";
import type { CubeView } from "../ports/cube_gateway.js";
import {
  TEST_SEMANTIC_TAXONOMY,
  TEST_TIME_SOURCE_REGISTRY,
} from "../test_support/semantic_taxonomy.js";

const buildCatalogDocument = (views: CubeView[]) =>
  buildRawCatalogDocument(views, TEST_SEMANTIC_TAXONOMY, TEST_TIME_SOURCE_REGISTRY, {
    id: "test_scope",
    title: "测试数据范围",
  });

const active_employee_count = (view: string, viewTitle: string): CubeView["measures"][number] => ({
  name: `${view}.active_employee_count`,
  title: `${viewTitle} 在职人数`,
  shortTitle: "在职人数",
  description: "所选月末仍在职的去重人数。",
  type: "number",
  aggType: "countDistinct",
  aliasMember: `${view}_fact.active_employee_count`,
  meta: {
    metric_domain_id: "metric_domain:workforce_structure",
    report_calculations: ["percent_of_total"],
    time_contract: { aggregation: "last", window: "selected" },
  },
});

const metaViews: CubeView[] = [
  {
    name: "test_people_metrics",
    title: "人员总览",
    description: "Agent 查询使用业务截止月份。",
    meta: {
      query_surface: "metric_source",
      time_source: "workforce",
      observation_scope: "统计范围：公开虚构数据中的示例员工。",
    },
    measures: [
      {
        name: "test_people_metrics.ytd_primary_event_rate",
        title: "人员总览 YTD主要事件率",
        shortTitle: "YTD主要事件率",
        description: "年初至截止月主要事件数 ÷ 年初至截止月月均基数。",
        type: "number",
        format: "percent",
        aliasMember: "test_people_metrics.ytd_primary_event_rate",
        meta: {
          metric_domain_id: "metric_domain:workforce_movement",
          ai_context: "只供 Agent 的时间选择规则",
          sensitivity: "restricted",
          time_contract: { aggregation: "recompute", window: "year_to_date" },
          components: {
            numerator: "ytd_primary_event_count",
            denominator: "ytd_average_base",
          },
          incompatible_dimensions: [
            { member: "department_name", reason: "该口径不能按末级部门拆分。" },
          ],
        },
      },
      {
        name: "test_people_metrics.ytd_primary_event_count",
        title: "人员总览 YTD主要事件数",
        shortTitle: "YTD主要事件数",
        description: "年初至截止月累计主要事件数。",
        type: "number",
        aggType: "countDistinct",
        meta: {
          metric_domain_id: "metric_domain:workforce_movement",
          time_contract: { aggregation: "sum", window: "year_to_date" },
        },
      },
      {
        name: "test_people_metrics.ytd_average_base",
        title: "人员总览 YTD月均基数",
        shortTitle: "YTD月均基数",
        description: "年初至截止月基数的算术平均值。",
        type: "number",
        aggType: "number",
        meta: {
          metric_domain_id: "metric_domain:workforce_movement",
          time_contract: { aggregation: "average", window: "year_to_date" },
        },
      },
    ],
    dimensions: [
      {
        name: "test_people_metrics.organization_name",
        meta: { dimension_group: "organization" },
        title: "人员总览 组织",
        shortTitle: "组织",
        description: "员工所属组织。",
        type: "string",
        aliasMember: "test_people_metrics.organization_name",
      },
      {
        name: "test_people_metrics.employee_name",
        title: "姓名",
        description: "员工姓名。",
        type: "string",
        aliasMember: "test_people_metrics.employee_name",
        meta: { dimension_group: "employee_basic_info" },
      },
      {
        name: "test_people_metrics.department_name",
        meta: { dimension_group: "organization" },
        title: "部门",
        shortTitle: "部门",
        description: "员工末级部门。",
        type: "string",
        aliasMember: "test_people_metrics.department_name",
      },
    ],
    internalDimensions: [
      { name: "test_people_metrics.record_key", title: "行键", type: "string" },
      { name: "test_people_metrics.employee_id", title: "员工编号", type: "string" },
    ],
  },
  {
    name: "employee_attributes_fixture",
    title: "员工信息",
    description: "Agent 查询须使用月末快照口径。",
    meta: {
      query_surface: "metric_source",
      time_source: "workforce",
      observation_scope: "统计范围：公开虚构数据中的示例员工。",
    },
    measures: [
      active_employee_count("employee_attributes_fixture", "员工信息"),
      {
        name: "employee_attributes_fixture.active_employee_share",
        title: "员工信息 在职人数占比",
        shortTitle: "在职人数占比",
        description: "该分组在职人数占查询范围内在职总人数的比例。",
        type: "number",
        format: "percent",
        aliasMember: "employee_attributes_fixture.active_employee_share",
        meta: {
          metric_domain_id: "metric_domain:workforce_structure",
          time_contract: { aggregation: "recompute", window: "selected" },
          calculation_role: "structure_share",
          components: {
            numerator: "active_employee_count",
            denominator: "active_employee_scope_total",
          },
        },
      },
      {
        name: "employee_attributes_fixture.active_employee_scope_total",
        title: "员工信息 在职人数范围合计",
        shortTitle: "在职人数范围合计",
        description: "在职人数占比的分母：查询范围内的在职总人数。",
        type: "number",
        aliasMember: "employee_attributes_fixture.active_employee_scope_total",
        meta: {
          metric_domain_id: "metric_domain:workforce_structure",
          time_contract: { aggregation: "last", window: "selected" },
          calculation_role: "scope_denominator",
          ai_context: "一般随占比自动理解、无需单独查询",
        },
      },
    ],
    dimensions: [
      {
        name: "employee_attributes_fixture.organization_name",
        meta: { dimension_group: "organization" },
        title: "员工信息 组织",
        shortTitle: "组织",
        description: "员工所属组织。",
        type: "string",
        aliasMember: "employee_attributes_fixture.organization_name",
      },
      {
        name: "employee_attributes_fixture.classification_source",
        meta: { dimension_group: "job_and_level" },
        title: "员工信息 分类来源",
        shortTitle: "分类来源",
        description: "记录所属分类的来源。",
        type: "string",
        aliasMember: "classification.source",
      },
      {
        name: "employee_attributes_fixture.category_band",
        title: "员工信息 分类层级",
        shortTitle: "分类层级",
        description: "记录在统计时点所属的分类层级。",
        type: "string",
        aliasMember: "employee_attributes_fixture.category_band",
        meta: {
          dimension_group: "job_and_level",
          ai_context:
            "Level A+ 至 Level D+ 按等级及以上理解，例如 Level C+ 选择 Level C 和 Level D。",
        },
      },
    ],
  },
  {
    name: "employee_detail_fixture",
    title: "人员明细",
    description: "只用于受控人员明细。",
    meta: {
      query_surface: "detail",
      time_source: "workforce",
      observation_scope: "统计范围：公开虚构数据中的示例员工。",
      record_sets: {
        employee: {
          title: "员工记录",
          description: "构成指标结果的员工记录。",
          record_key: "record_key",
          entity_key: "employee_id",
          fields: [{ member: "employee_id" }, { member: "employee_name" }],
          entity_order: [{ member: "record_key", direction: "asc" }],
        },
      },
    },
    measures: [
      {
        ...active_employee_count("employee_detail_fixture", "人员明细"),
        meta: {
          metric_domain_id: "metric_domain:workforce_structure",
          report_calculations: ["percent_of_total"],
          time_contract: { aggregation: "last", window: "selected" },
          underlying_records: {
            record_set: "employee",
            selection: { kind: "self" },
          },
        },
      },
    ],
    dimensions: [
      {
        name: "employee_detail_fixture.organization_name",
        meta: { dimension_group: "organization" },
        title: "人员明细 组织",
        shortTitle: "组织",
        description: "员工所属组织。",
        type: "string",
        aliasMember: "employee_detail_fixture.organization_name",
      },
      {
        name: "employee_detail_fixture.employee_name",
        title: "姓名",
        description: "员工姓名。",
        type: "string",
        aliasMember: "employee_detail_fixture.employee_name",
        meta: { dimension_group: "employee_basic_info" },
      },
    ],
    internalDimensions: [
      { name: "employee_detail_fixture.record_key", title: "行键", type: "string" },
      { name: "employee_detail_fixture.employee_id", title: "员工编号", type: "string" },
    ],
  },
];

/** Cube /meta 顺序不作为目录契约；指标域按稳定 id 排序。 */
const views: CubeView[] = [...metaViews].sort((a, b) => a.name.localeCompare(b.name));

describe("CatalogDocument", () => {
  test("从权限裁剪后的 views 归一成员与时间源", () => {
    const document = buildCatalogDocument(views);
    expect(document.observation_scopes).toEqual(["统计范围：公开虚构数据中的示例员工。"]);
    expect(views[0].name).toBe("employee_attributes_fixture");
    expect(document.views.map((view) => view.name)).toEqual([
      "employee_attributes_fixture",
      "employee_detail_fixture",
      "test_people_metrics",
    ]);
    expect(document.views[2]).toMatchObject({
      name: "test_people_metrics",
      time_source: "workforce",
    });
    expect(document.views[2].measures[0]).toMatchObject({
      title: "人员总览 YTD主要事件率",
      display_title: "YTD主要事件率",
      ai_context: "只供 Agent 的时间选择规则",
      components: {
        numerator: "test_people_metrics.ytd_primary_event_count",
        denominator: "test_people_metrics.ytd_average_base",
      },
    });
    expect(document.views[2].dimensions[0].dimension_kind).toBe("categorical");
    expect(document.views[2].dimensions[1].dimension_kind).toBe("categorical");
  });

  test("规范同名身份跨事实归并，available_in 载明精确查询绑定", () => {
    const catalog = canonicalCatalog(buildCatalogDocument(views));
    const activeEmployees = catalog.measures.filter((m) => m.title === "在职人数");
    expect(activeEmployees).toHaveLength(1);
    expect(activeEmployees[0]).toMatchObject({
      id: "measure:active_employee_count",
      name: "employee_attributes_fixture.active_employee_count",
      available_in: [
        {
          view: "employee_attributes_fixture",
          member: "employee_attributes_fixture.active_employee_count",
        },
        {
          view: "employee_detail_fixture",
          member: "employee_detail_fixture.active_employee_count",
          detail: true,
        },
      ],
    });
    const organizations = catalog.dimensions.filter((member) => member.title === "组织");
    expect(organizations).toHaveLength(1);
    expect(organizations[0].id).toBe("dimension:organization_name");
    expect(organizations[0].available_in).toEqual([
      {
        view: "employee_attributes_fixture",
        member: "employee_attributes_fixture.organization_name",
      },
      {
        view: "employee_detail_fixture",
        member: "employee_detail_fixture.organization_name",
        detail: true,
      },
      {
        view: "test_people_metrics",
        member: "test_people_metrics.organization_name",
      },
    ]);
    // 键集合全等：消费面只有这些字段，任何别的物理血缘或语义身份字段都进不来
    expect(Object.keys(activeEmployees[0]).sort()).toEqual([
      "available_in",
      "description",
      "id",
      "kind",
      "metric_domain_id",
      "name",
      "report_calculations",
      "time",
      "title",
    ]);
    expect(Object.keys(organizations[0]).sort()).toEqual([
      "available_in",
      "description",
      "dimension_group",
      "dimension_kind",
      "id",
      "kind",
      "name",
      "title",
    ]);
    const classificationSource = catalog.dimensions.find((d) => d.title === "分类来源");
    expect(classificationSource?.id).toBe("dimension:classification_source");
    expect(
      canonicalCatalog(buildCatalogDocument(views)).dimensions.find((d) => d.title === "分类来源")
        ?.id,
    ).toBe(classificationSource?.id);
    expect(classificationSource?.available_in).toEqual([
      {
        view: "employee_attributes_fixture",
        member: "employee_attributes_fixture.classification_source",
      },
    ]);
  });

  test("上线的维度必带业务属性组：缺归属的维度让整份目录出不去", () => {
    const ungrouped = views.map((view) => ({
      ...view,
      dimensions: view.dimensions.map(({ meta, ...dimension }) => ({
        ...dimension,
        meta: { ...meta, dimension_group: undefined },
      })),
    }));
    expect(() => toSemanticCatalog(buildCatalogDocument(ungrouped))).toThrow(/缺少业务属性组归属/);
  });

  test("敏感度只认「受限」一个词：模型写别的词，目录出不去", () => {
    const mislabeled = views.map((view) => ({
      ...view,
      dimensions: view.dimensions.map((dimension) => ({
        ...dimension,
        meta: { ...dimension.meta, sensitivity: "confidential" },
      })),
    }));
    expect(() => buildCatalogDocument(mislabeled)).toThrow(/sensitivity 声明无效/);
  });

  test("人的投影：去重指标、折叠分母零件、公式行翻成中文，且只含白名单", () => {
    const payload = toSemanticCatalog(buildCatalogDocument(views));
    expect(payload.metric_domains.map((topic) => topic.title)).toEqual([
      "人员规模与结构",
      "人员流动",
    ]);
    expect(payload.metric_domains[1]).toMatchObject({ id: "metric_domain:workforce_movement" });
    expect(payload.metric_domains[1]).not.toHaveProperty("name");
    expect(payload.metric_domains[1]).not.toHaveProperty("measures");
    // 指标域详情承 Agent 查询说明、数据时间业务标签与真实同义词。
    expect(payload.metric_domains[1]).not.toHaveProperty("time_source");
    expect(payload.metric_domains[1]).toMatchObject({
      query_contract: expect.stringContaining("入职、离职"),
      time_context_title: "人员数据",
      synonyms: expect.arrayContaining(["人员流入", "人员流出", "离职率"]),
    });

    const titles = payload.measures.map((m) => m.title);
    expect(titles).toContain("在职人数");
    expect(titles.filter((t) => t === "在职人数")).toHaveLength(1);
    // 分母零件不进主表——它只是引擎侧零件，不是可交付的指标
    expect(titles).not.toContain("在职人数范围合计");
    // 但其口径仍以中文出现在占比指标的公式行里（折叠不等于口径消失）
    expect(payload.measures.find((m) => m.title === "在职人数占比")?.formula).toEqual({
      numerator: "在职人数",
      numerator_id: "measure:active_employee_count",
      denominator: "在职人数范围合计",
      denominator_id: "measure:active_employee_scope_total",
    });
    expect(payload.measures.find((m) => m.title === "在职人数占比")?.relation).toEqual({
      kind: "structure_share",
      numerator_id: "measure:active_employee_count",
    });
    // 对外语义成员不含物理绑定；可查视图与限定名只在编译器目录里
    expect(payload.measures.find((m) => m.title === "在职人数")).not.toHaveProperty("available_in");
    expect(payload.measures.find((m) => m.title === "在职人数")).not.toHaveProperty("name");
    expect(payload.measures.find((m) => m.title === "在职人数")?.report_calculations).toEqual([
      "percent_of_total",
    ]);
    expect(
      payload.measures.find((m) => m.title === "在职人数占比")?.query_capabilities,
    ).toMatchObject({
      grouping: { minimum_varying_dimensions: 1 },
    });
    expect(payload.dimensions.find((d) => d.title === "组织")?.dimension_kind).toBe("categorical");
    // Agent 选材与避坑规则随成员亮出，供人核对 AI 的查询行为
    expect(payload.measures.find((m) => m.title === "YTD主要事件率")?.ai_context).toBe(
      "只供 Agent 的时间选择规则",
    );
    // 查询能力以正向白名单交付，客户端只需计算所选指标的能力交集。
    const deptId = payload.dimensions.find((d) => d.title === "部门")?.id ?? "";
    expect(deptId).toBe("dimension:department_name");
    expect(
      payload.measures.find((m) => m.title === "YTD主要事件率")?.query_capabilities?.dimension_ids,
    ).not.toContain(deptId);

    // 引擎零件仍不跨受众：夹具里真实存在的执行 view 名与限定成员名一个都不上线
    const json = JSON.stringify(payload);
    for (const physical of ["test_people_metrics", "employee_attributes_fixture", "_fact."]) {
      expect(json, physical).not.toContain(physical);
    }
  });

  test("人的投影：指标域带上域内指标与域内可拆维度，客户端不必自行推断", () => {
    const payload = toSemanticCatalog(buildCatalogDocument(views));
    const byId = new Map(payload.metric_domains.map((topic) => [topic.id, topic]));
    const structure = byId.get("metric_domain:workforce_structure")!;
    const movement = byId.get("metric_domain:workforce_movement")!;

    // 从属只由域这一头说：成员不反向携带域 id，域列全本次响应里的指标。
    expect(payload.measures.every((member) => !("metric_domain_id" in member))).toBe(true);
    const owned = [...structure.measure_ids, ...movement.measure_ids];
    expect(owned).toContain("measure:ytd_primary_event_rate");
    expect(new Set(owned).size).toBe(owned.length);
    for (const id of owned) {
      expect(payload.measures.some((member) => member.id === id)).toBe(true);
    }

    // 可拆维度按物理可用性逐域判定，不是把维度表整个发给每个域。
    const ids = payload.dimensions.map((member) => member.id);
    expect(structure.dimension_ids).toContain("dimension:classification_source");
    expect(movement.dimension_ids).not.toContain("dimension:classification_source");
    expect(movement.dimension_ids).toContain("dimension:department_name");
    for (const id of [...structure.dimension_ids, ...movement.dimension_ids]) {
      expect(ids).toContain(id);
    }
  });

  test("查询能力把物理可用性、负向限制与层级折叠成一份正向语义投影", () => {
    const hierarchical = views.map((view) =>
      view.name === "employee_attributes_fixture"
        ? {
            ...view,
            measures: view.measures.map((measure) =>
              measure.name === "employee_attributes_fixture.active_employee_share"
                ? {
                    ...measure,
                    meta: {
                      ...measure.meta,
                      incompatible_dimensions: [
                        {
                          member: "classification_source",
                          reason: "该指标只按稳定分类层级分析。",
                        },
                      ],
                    },
                  }
                : measure,
            ),
            hierarchies: [
              {
                name: "organization_category",
                levels: [
                  "employee_attributes_fixture.organization_name",
                  "employee_attributes_fixture.classification_source",
                  "employee_attributes_fixture.category_band",
                ],
              },
            ],
          }
        : view,
    );
    const capabilities = toSemanticCatalog(buildCatalogDocument(hierarchical)).measures.find(
      ({ id }) => id === "measure:active_employee_share",
    )?.query_capabilities;
    expect(capabilities).toEqual({
      dimension_ids: ["dimension:category_band", "dimension:organization_name"],
      hierarchies: [["dimension:organization_name", "dimension:category_band"]],
      grouping: { minimum_varying_dimensions: 1 },
    });
  });

  test("公共目录只投影会约束选择的时间能力，不泄漏内部时间合同", () => {
    const cardOf = (document: CatalogDocument) =>
      toSemanticCatalog(document).measures.find((member) => member.title === "YTD主要事件率");
    const withGrain = (grain?: "month") => {
      const document = buildCatalogDocument(views);
      const metric = document.views
        .flatMap((view) => view.measures)
        .find((member) => member.display_title === "YTD主要事件率");
      if (!metric?.time) throw new Error("fixture 缺时间面");
      metric.time = {
        ...metric.time,
        contract: { ...metric.time.contract, ...(grain ? { grain } : {}) },
      };
      return cardOf(document);
    };
    // 年初累计合同 ⇒ 年度归零位；再叠加按月定义 ⇒ 两位并存，各自独立成立。
    expect(withGrain()?.time).toEqual({
      value_basis: "year_start_to_bucket_end",
      constraints: { year_scoped: true },
    });
    expect(withGrain("month")?.time).toEqual({
      value_basis: "year_start_to_bucket_end",
      constraints: { grain: "month", year_scoped: true },
    });
    expect(withGrain()).not.toHaveProperty("time_contract");
    // 求值基准恒在场，限制位只在真有约束时出现——两个问题各答各的。
    const plain = toSemanticCatalog(buildCatalogDocument(views)).measures.find(
      (member) => member.title.includes("在职人数") && !member.title.includes("YTD"),
    );
    expect(plain?.time).toEqual({ value_basis: "bucket_end" });
    expect(plain).not.toHaveProperty("time_contract");
  });

  test("明细入口只认指标显式声明的记录选择，未声明指标保持关闭", () => {
    const fixture: CubeView = {
      name: "record_projection_fixture",
      title: "明细推导",
      meta: {
        query_surface: "metric_source",
        time_source: "workforce",
        observation_scope: "测试口径。",
        record_sets: {
          employee: {
            title: "员工记录",
            description: "构成指标结果的员工记录。",
            record_key: "record_key",
            entity_key: "employee_id",
            fields: [{ member: "employee_id" }],
            entity_order: [{ member: "record_key", direction: "asc" }],
          },
        },
      },
      dimensions: [],
      internalDimensions: [
        { name: "record_projection_fixture.record_key", title: "行键", type: "string" },
        { name: "record_projection_fixture.employee_id", title: "员工编号", type: "string" },
      ],
      measures: [
        {
          name: "record_projection_fixture.events",
          title: "事件数",
          description: "符合条件的事件记录数。",
          type: "number",
          aggType: "count",
          meta: {
            metric_domain_id: "metric_domain:workforce_movement",
            time_contract: { aggregation: "sum", window: "selected" },
            underlying_records: {
              record_set: "employee",
              selection: { kind: "self" },
            },
          },
        },
        {
          name: "record_projection_fixture.rate",
          title: "事件率",
          description: "事件数除以人数。",
          type: "number",
          aggType: "number",
          meta: {
            metric_domain_id: "metric_domain:workforce_movement",
            time_contract: { aggregation: "recompute", window: "selected" },
            components: { numerator: "events", denominator: "population" },
            underlying_records: {
              record_set: "employee",
              selection: { kind: "numerator" },
            },
          },
        },
        {
          name: "record_projection_fixture.population",
          title: "人数",
          description: "统计范围内人数。",
          type: "number",
          aggType: "avg",
          meta: {
            metric_domain_id: "metric_domain:workforce_movement",
            time_contract: { aggregation: "average", window: "selected" },
          },
        },
        {
          name: "record_projection_fixture.opaque_score",
          title: "综合得分",
          description: "综合计算得分。",
          type: "number",
          aggType: "number",
          meta: {
            metric_domain_id: "metric_domain:workforce_movement",
            time_contract: { aggregation: "last", window: "selected" },
          },
        },
      ],
    };
    const payload = toSemanticCatalog(buildCatalogDocument([fixture]));
    expect(payload.measures.find((measure) => measure.title === "事件数")?.records_available).toBe(
      true,
    );
    expect(payload.measures.find((measure) => measure.title === "事件率")?.records_available).toBe(
      true,
    );
    expect(
      payload.measures.find((measure) => measure.title === "人数")?.records_available,
    ).toBeUndefined();
    expect(
      payload.measures.find((measure) => measure.title === "综合得分")?.records_available,
    ).toBeUndefined();
    // 公式零件在夹具里是短名、成员是限定名，两种写法都须解析为中文。
    expect(payload.measures.find((measure) => measure.title === "事件率")?.formula).toEqual({
      numerator: "事件数",
      numerator_id: "measure:events",
      denominator: "人数",
      denominator_id: "measure:population",
    });
  });

  test("同一指标只有具备底层记录投影的物理绑定可用于明细（编译器目录）", () => {
    const payload = toCompilerCatalog(buildCatalogDocument(views));
    const active_employee_count = payload.measures.find((measure) => measure.title === "在职人数")!;
    expect(active_employee_count.records_available).toBe(true);
    expect(active_employee_count.available_in).toEqual([
      {
        view: "employee_attributes_fixture",
        member: "employee_attributes_fixture.active_employee_count",
      },
      {
        view: "employee_detail_fixture",
        member: "employee_detail_fixture.active_employee_count",
        detail: true,
        records_available: true,
      },
    ]);
  });

  test("目录装配拒绝实体键不在记录集展示字段中的明细模型", () => {
    const invalid = structuredClone(
      metaViews.find((view) => view.name === "employee_detail_fixture")!,
    );
    const recordSets = invalid.meta?.record_sets as {
      employee: { fields: { member: string }[] };
    };
    recordSets.employee.fields = [{ member: "employee_name" }];
    expect(() => buildCatalogDocument([invalid])).toThrow("底层记录集配置无效");
  });

  test("装配拒绝解析为年初累计却声明 selected 的合同：声明与求值不得背离", () => {
    // recompute 的求值继承组件；能力卡读声明字段，背离会让编辑器放行守卫必拒的组合。
    const withRateWindow = (window: "selected" | "year_to_date"): CubeView[] => [
      {
        name: "flow",
        title: "流动",
        meta: { time_source: "workforce", observation_scope: "统计范围：测试" },
        dimensions: [],
        measures: [
          {
            name: "flow.ytd_event",
            title: "YTD事件数",
            type: "number",
            meta: {
              metric_domain_id: "metric_domain:workforce_movement",
              time_contract: { aggregation: "sum", window: "year_to_date" },
            },
          },
          {
            name: "flow.ytd_average_base",
            title: "YTD月均基数",
            type: "number",
            meta: {
              metric_domain_id: "metric_domain:workforce_movement",
              time_contract: { aggregation: "average", window: "year_to_date" },
            },
          },
          {
            name: "flow.ytd_rate",
            title: "YTD事件率",
            type: "number",
            meta: {
              metric_domain_id: "metric_domain:workforce_movement",
              time_contract: { aggregation: "recompute", window },
              components: {
                numerator: "ytd_event",
                denominator: "ytd_average_base",
              },
            },
          },
        ],
      },
    ];
    expect(() => buildCatalogDocument(withRateWindow("selected"))).toThrow(/声明与求值不得背离/);
    const card = toSemanticCatalog(
      buildCatalogDocument(withRateWindow("year_to_date")),
    ).measures.find((member) => member.title === "YTD事件率");
    expect(card?.time).toEqual({
      value_basis: "year_start_to_bucket_end",
      constraints: { year_scoped: true },
    });
  });

  test("公式行两端都译成中文，译不出就整行不发——绝不拿物理名顶替", () => {
    // 分母另居一个视图：装配只能按声明它的视图去限定零件名，跨视图那半会一路以短名到底。
    const rateViews = (denominator: string): CubeView[] => {
      const view = (name: string, measures: CubeView["measures"]): CubeView => ({
        name,
        title: name,
        meta: { time_source: "workforce", observation_scope: "统计范围：测试" },
        dimensions: [],
        measures,
      });
      const measure = (
        name: string,
        title: string,
        aggregation: "sum" | "average" | "recompute",
        extra: Record<string, unknown> = {},
      ) => ({
        name,
        title,
        type: "number" as const,
        meta: {
          metric_domain_id: "metric_domain:workforce_movement" as const,
          time_contract: { aggregation, window: "year_to_date" as const },
          ...extra,
        },
      });
      const leave = view("leave", [
        measure("leave.ytd_event", "YTD事件数", "sum"),
        measure("leave.ytd_rate", "YTD事件率", "recompute", {
          components: { numerator: "ytd_event", denominator },
        }),
      ]);
      return [
        {
          ...leave,
          // 内部计算件：不可查、不进任何成员面，只在模型里写了个业务名。
          internalMeasures: [
            {
              name: "leave.ytd_answered",
              title: "YTD答卷人数",
              type: "number",
              meta: { internal: true, member_role: "calculation_input" },
            },
            {
              name: "leave.ytd_unnamed",
              title: "",
              type: "number",
              meta: { internal: true, member_role: "calculation_input" },
            },
          ],
        },
        view("snapshot", [measure("snapshot.ytd_headcount", "YTD月均基数", "average")]),
      ];
    };
    const rateOf = (denominator: string) =>
      toSemanticCatalog(buildCatalogDocument(rateViews(denominator))).measures.find(
        (member) => member.title === "YTD事件率",
      );
    // 跨视图零件只剩短名，仍须解析出中文与语义身份。
    expect(rateOf("ytd_headcount")?.formula).toEqual({
      numerator: "YTD事件数",
      numerator_id: "measure:ytd_event",
      denominator: "YTD月均基数",
      denominator_id: "measure:ytd_headcount",
    });
    // 内部计算件无公开身份：公式行只出标题，不出 id。
    expect(rateOf("ytd_answered")?.formula).toEqual({
      numerator: "YTD事件数",
      numerator_id: "measure:ytd_event",
      denominator: "YTD答卷人数",
    });
    // 只有模型里真的没给业务名时才整行不发，而不是印出它的物理名。
    const unnamed = rateOf("ytd_unnamed");
    expect(unnamed?.formula).toBeUndefined();
    expect(unnamed?.title).toBe("YTD事件率");
  });

  test("指标域身份属于指标，缺失或误挂到 View 均 fail-closed", () => {
    const missing = structuredClone(metaViews[0]);
    delete missing.measures[0]?.meta?.metric_domain_id;
    expect(() => buildCatalogDocument([missing])).toThrow("metric_domain_id");

    const misplaced = structuredClone(metaViews[0]);
    misplaced.meta!.metric_domain_id = "metric_domain:workforce_structure";
    expect(() => buildCatalogDocument([misplaced])).toThrow("业务域归属必须声明在指标上");

    const detail = structuredClone(metaViews[2]);
    detail.meta!.metric_domain_id = "metric_domain:workforce_structure";
    expect(() => buildCatalogDocument([detail])).toThrow("业务域归属必须声明在指标上");
  });

  test("MCP 浏览与检索同构返回语义成员；检索去重并保留逐词记账", () => {
    const document = buildCatalogDocument(views);
    const browse = browseCatalogDocument(document);
    const overview = browse.metric_domains.find((row) => row.title === "人员流动");
    expect(overview?.measure_ids).toEqual([
      "measure:ytd_primary_event_rate",
      "measure:ytd_primary_event_count",
      "measure:ytd_average_base",
    ]);
    expect(overview).not.toHaveProperty("view");
    expect(browse.measures.find((member) => member.title === "在职人数")).toMatchObject({
      id: "measure:active_employee_count",
      kind: "measure",
    });
    expect(browse.measures.some((member) => member.title === "在职人数范围合计")).toBe(false);

    const result = searchCatalogDocument(
      document,
      ["主要事件率", "加班时长"],
      new Set(["dimension:organization_name"]),
    );
    expect(Object.keys(result).sort()).toEqual(Object.keys(browse).sort());
    expect(result.matched_terms).toEqual(["主要事件率"]);
    expect(result.unmatched_terms).toEqual(["加班时长"]);
    expect(result.dimensions.map((member) => member.id)).toContain("dimension:organization_name");
    expect(result.metric_domains[0]).not.toHaveProperty("view");

    const activeEmployees = searchCatalogDocument(document, ["在职人数"]);
    // 一个指标一份口径全文；Agent 面单语言——语义 id + 教学字段，无物理绑定
    expect(activeEmployees.measures.filter((m) => m.title === "在职人数")).toHaveLength(1);
    expect(
      activeEmployees.measures.find((member) => member.title === "在职人数"),
    ).not.toHaveProperty("available_in");
    expect(
      activeEmployees.measures.find((member) => member.title === "在职人数"),
    ).not.toHaveProperty("name");
    expect(activeEmployees.metric_domains.map((row) => row.title)).toEqual(["人员规模与结构"]);
    expect(activeEmployees.metric_domains[0]).not.toHaveProperty("view");
    expect(activeEmployees.metric_domains[0]?.measure_ids).toEqual([
      "measure:active_employee_count",
      "measure:active_employee_share",
    ]);
    expect(activeEmployees.measures[0]).not.toHaveProperty("display_title");

    const levelCAndAbove = searchCatalogDocument(document, ["Level C+"]);
    expect(levelCAndAbove.matched_terms).toEqual(["Level C+"]);
    expect(levelCAndAbove.dimensions).toEqual([
      expect.objectContaining({
        id: "dimension:category_band",
        title: "分类层级",
      }),
    ]);
    expect(levelCAndAbove.metric_domains.map((row) => row.title)).toEqual(["人员规模与结构"]);
  });
});

test("装配不向未声明时间合同的内部辅助度量索要合同", () => {
  const view: CubeView = {
    name: "flow",
    title: "人员流动",
    meta: { time_source: "workforce", observation_scope: "测试人群口径。" },
    measures: [
      {
        name: "flow.turnover_count",
        title: "离职人数",
        type: "number",
        meta: {
          metric_domain_id: "metric_domain:workforce_movement",
          time_contract: { aggregation: "sum", window: "selected" },
        },
      },
    ],
    dimensions: [],
    internalMeasures: [
      { name: "flow.raw_records", title: "在职员工记录", type: "number", meta: { internal: true } },
    ],
  };
  expect(() => buildCatalogDocument([view])).not.toThrow();
  expect(() =>
    buildCatalogDocument([
      {
        ...view,
        measures: [
          {
            ...view.measures[0],
            meta: { metric_domain_id: "metric_domain:workforce_movement" },
          },
        ],
      },
    ]),
  ).toThrow(/时间聚合合同/);
});
