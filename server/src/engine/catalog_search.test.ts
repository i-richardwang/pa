/**
 * catalog 检索单测：购物单契约——terms 逐项命中、覆盖度排序、零命中剔除；
 * 成员命中分层——title 是主检索键，description 与 ai_context 只对全局零命中词做兜底召回。
 * 视图级回退（命中视图且无成员命中时给全量）的裁决在 server handler，这里守匹配原语。
 */
import { describe, expect, test } from "bun:test";
import { memberFallbackTokens, memberHit, rankMembers } from "./catalog_search.js";
import type { CubeMember } from "../ports/cube_gateway.js";

const member = (name: string, title: string, description = ""): CubeMember => ({
  name,
  title,
  type: "number",
  description,
});

const members: CubeMember[] = [
  member("employee.active_employee_count", "在职人数", "月末在职人数；进行中月份为 T+1 数据"),
  member("employee.ytd_secondary_event_count", "YTD次要事件数", "年初至截止月的累计次要事件数"),
  member("employee.ytd_event_count", "YTD事件数", "年初至截止月的累计事件数"),
  member("employee.ytd_primary_event_rate", "YTD主要事件率", "累计主要事件数 ÷ 同期月均基数"),
  member("employee.ytd_secondary_event_rate", "YTD对照事件率", "累计对照事件数 ÷ 同期月均基数"),
  member("employee.ytd_event_rate", "YTD事件率", "累计事件数 ÷ 同期月均基数"),
  member("employee.active_employee_share", "在职人数占比", "分组在职人数 ÷ 全部在职人数"),
  member("employee.fulfillment_rate", "目标完成率", "当前数量 ÷ 月度目标数"),
  member("employee.contract_type", "合同类型", "长期合同员工使用固定期限或无固定期限合同"),
];

const view = {
  measures: members.slice(0, 8),
  dimensions: [members[8]],
};

/** 无兜底词的空集：多数用例的检索词都能在 name/title 上命中 */
const noFallback = new Set<string>();

describe("rankMembers", () => {
  test("多概念检索：每个概念各自领回匹配成员", () => {
    const hit = rankMembers(["事件率", "主要", "对照"], members, noFallback);
    const titles = hit.map((m) => m.title);
    expect(titles).toContain("YTD主要事件率");
    expect(titles).toContain("YTD对照事件率");
    expect(titles).toContain("YTD事件率");
    expect(titles).not.toContain("目标完成率");
  });

  test("覆盖度排序：命中两个词的成员排在命中一个词的前面", () => {
    const hit = rankMembers(["事件率", "主要"], members, noFallback);
    expect(hit[0].title).toBe("YTD主要事件率");
  });

  test("购物单语义：不同概念的成员并列返回", () => {
    const hit = rankMembers(["在职", "次要", "事件"], members, noFallback);
    const titles = hit.map((m) => m.title);
    expect(titles).toContain("在职人数");
    expect(titles).toContain("YTD次要事件数");
    expect(titles).toContain("YTD事件数");
  });

  test("零命中成员剔除、同分保持目录原序", () => {
    const hit = rankMembers(["ytd"], members, noFallback);
    expect(hit).toHaveLength(5);
    expect(hit[0].title).toBe("YTD次要事件数");
    expect(hit.map((m) => m.title)).not.toContain("在职人数");
  });

  test("全无命中得空数组", () => {
    expect(rankMembers(["技能矩阵"], members, noFallback)).toHaveLength(0);
  });
});

describe("分层匹配：description 是口径契约不是检索键", () => {
  test("name/title 已命中的词不经 description 扩散", () => {
    const tokens = ["在职", "次要", "事件", "组织"];
    const fallback = memberFallbackTokens(tokens, [view]);
    const titles = rankMembers(tokens, members, fallback).map((m) => m.title);
    expect(titles).not.toContain("高级职级占比");
    expect(titles).not.toContain("目标完成率");
    expect(titles).not.toContain("合同类型");
    expect(titles).toContain("在职人数");
    expect(titles).toContain("YTD事件率");
  });

  test("全局零命中的词降级用 description 补召回（只存在于口径说明的概念不失联）", () => {
    const tokens = ["长期合同", "事件率"];
    const fallback = memberFallbackTokens(tokens, [view]);
    expect(fallback.has("长期合同")).toBe(true);
    expect(fallback.has("事件率")).toBe(false);
    const titles = rankMembers(tokens, members, fallback).map((m) => m.title);
    expect(titles).toContain("合同类型");
    expect(titles).toContain("YTD事件率");
  });

  test("兜底判定是逐词全局的：词在任一成员 name/title 命中即不进兜底集", () => {
    const fallback = memberFallbackTokens(["在职", "长期合同", "远程办公"], [view]);
    expect([...fallback].sort()).toEqual(["长期合同", "远程办公"].sort());
  });

  test("memberHit：description 仅对兜底词开放", () => {
    const contractType = members[8];
    expect(memberHit("长期合同", contractType, false)).toBe(false);
    expect(memberHit("长期合同", contractType, true)).toBe(true);
    expect(memberHit("合同", contractType, false)).toBe(true);
  });

  test("ai_context 让业务范围写法发现权威维度，但不参与普通宽检索", () => {
    const categoryBand = {
      ...member("employee.category_band", "分类层级", "记录在统计时点所属的分类层级。"),
      ai_context: "Level A+ 至 Level D+ 按等级及以上理解，例如 Level C+ 选择 Level C 和 Level D。",
    };
    const searchable = { measures: [], dimensions: [categoryBand] };
    const fallback = memberFallbackTokens(["Level C+"], [searchable]);

    expect(fallback.has("Level C+")).toBe(true);
    expect(rankMembers(["Level C+"], [categoryBand], fallback).map((item) => item.title)).toEqual([
      "分类层级",
    ]);
    expect(memberHit("Level C+", categoryBand, false)).toBe(false);
  });
});
