import { expect, test } from "bun:test";
import type { PublicCatalogDimension, PublicCatalogDocument } from "@contracts/catalog_contract";
import type { PublicBusinessTerm } from "@contracts/business_term_contract";
import { ALL, filterDimensions, filterMeasures, filterTerms } from "./catalog_filters";

const CATALOG = {
  access_scope: { id: "organization", title: "组织" },
  observation_scopes: [],
  data_as_of: "2026-07",
  time_context: [],
  metric_domains: [
    {
      id: "metric_domain:turnover",
      title: "人员流动",
      synonyms: ["Turnover"],
      dimension_ids: [],
      measure_ids: ["measure:exit_count"],
    },
    {
      id: "metric_domain:headcount",
      title: "人员规模与结构",
      synonyms: ["Headcount"],
      dimension_ids: [],
      measure_ids: ["measure:headcount"],
    },
  ],
  measures: [
    {
      kind: "measure",
      id: "measure:exit_count",
      title: "离职人数",
      description: "所选期间结束雇佣关系的员工人数。",
      query_capabilities: { dimension_ids: [] },
      time: { value_basis: "whole_bucket" },
    },
    {
      kind: "measure",
      id: "measure:headcount",
      title: "在职人数",
      description: "期末仍在职的员工人数。",
      query_capabilities: { dimension_ids: [] },
      time: { value_basis: "point_in_time" },
    },
  ],
  dimensions: [
    {
      kind: "dimension",
      id: "dimension:work_location",
      title: "工作地点",
      description: "员工在记录时点的主要工作地点。",
      dimension_group: { id: "group:employment", title: "雇佣信息" },
    },
    {
      kind: "dimension",
      id: "dimension:gender",
      title: "性别",
      description: "员工在记录时点的性别分类。",
      dimension_group: { id: "group:person", title: "员工基本信息" },
    },
  ],
} as unknown as PublicCatalogDocument;

const TERMS: PublicBusinessTerm[] = [
  {
    id: "t1",
    canonical_term: "主动离职",
    definition: "由员工主动提出并在所选期间实际发生的离职事件。",
    aliases: ["自愿离职"],
    related_members: [],
  } as unknown as PublicBusinessTerm,
];

test("指标搜到所属域的别名：域分面撤掉后这条发现路径改由指标页承担", () => {
  const bySynonym = filterMeasures(CATALOG, ALL, "Turnover").map((m) => m.id);
  expect(bySynonym).toEqual(["measure:exit_count"]);
  // 别名只把它自己那个域的指标带出来，不是全表放行。
  expect(filterMeasures(CATALOG, ALL, "Headcount").map((m) => m.id)).toEqual(["measure:headcount"]);
  expect(filterMeasures(CATALOG, ALL, "查无此词")).toEqual([]);
});

test("指标域筛选与搜索是两个条件，同时成立才留下", () => {
  expect(filterMeasures(CATALOG, "metric_domain:turnover", "").map((m) => m.id)).toEqual([
    "measure:exit_count",
  ]);
  expect(filterMeasures(CATALOG, "metric_domain:turnover", "在职")).toEqual([]);
});

test("维度页只搜维度：属性组既是筛选器也是命中字段", () => {
  const dimensions = CATALOG.dimensions as PublicCatalogDimension[];
  expect(filterDimensions(dimensions, ALL, "雇佣信息").map((d) => d.id)).toEqual([
    "dimension:work_location",
  ]);
  expect(filterDimensions(dimensions, "员工基本信息", "").map((d) => d.id)).toEqual([
    "dimension:gender",
  ]);
  // 指标名不在维度页里出现。
  expect(filterDimensions(dimensions, ALL, "离职人数")).toEqual([]);
});

test("术语按别名命中：黑话是这页存在的理由", () => {
  expect(filterTerms(TERMS, "自愿离职").map((t) => t.id)).toEqual(["t1"]);
  expect(filterTerms(TERMS, "在职人数")).toEqual([]);
});
