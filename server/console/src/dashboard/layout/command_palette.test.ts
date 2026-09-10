import { expect, test } from "bun:test";
import { itemText, type PaletteItem } from "./command_palette";

test("黑话进面板的可搜文本：术语别名与指标域别名都能命中", () => {
  const term: PaletteItem = {
    kind: "business_term",
    id: "t1",
    canonicalTerm: "主动离职",
    aliases: ["自愿离职"],
    definition: "由员工主动提出的离职事件。",
  };
  expect(itemText(term)).toContain("自愿离职");
  expect(itemText({ ...term, aliases: [] })).not.toContain("自愿离职");

  const domain: PaletteItem = {
    kind: "metric_domain",
    id: "metric_domain:turnover",
    title: "人员流动",
    synonyms: ["Turnover"],
  };
  expect(itemText(domain)).toContain("Turnover");
});

test("成员的语义 id 只进可搜文本，不进标签", () => {
  const member: PaletteItem = {
    kind: "member",
    name: "dimension:work_location",
    title: "工作地点",
    memberKind: "dimension",
  };
  expect(itemText(member)).toBe("工作地点 dimension:work_location");
});
