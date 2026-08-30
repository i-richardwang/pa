import { describe, expect, test } from "bun:test";
import { assignChannels, splitCandidates } from "./chart_channels.js";

const pool = (dimensions: string[], measures: string[]) => ({ dimensions, measures });

describe("通道装箱", () => {
  test("维度一个都不许剩下：折线的时间轴不吃维度，维度必须进拆分通道", () => {
    expect(assignChannels("line", pool([], ["headcount", "attrition"]))).toEqual({
      y: ["headcount", "attrition"],
    });
    expect(assignChannels("line", pool(["org"], ["headcount", "attrition"]))).toEqual({
      y: ["headcount"],
      groupBy: "org",
    });
    // 两个维度只有一个拆分通道可去，第二个无处安放
    expect(assignChannels("line", pool(["org", "level"], ["headcount"]))).toBeNull();
  });

  test("柱状的分类轴先吃一个维度，余数进拆分通道", () => {
    expect(assignChannels("bar", pool(["org"], ["headcount", "attrition"]))).toEqual({
      x: "org",
      y: ["headcount", "attrition"],
    });
    expect(assignChannels("bar", pool(["org", "level"], ["headcount"]))).toEqual({
      x: "org",
      y: ["headcount"],
      groupBy: "level",
    });
    expect(assignChannels("bar", pool(["org", "level", "grade"], ["headcount"]))).toBeNull();
    expect(assignChannels("bar", pool([], ["headcount"]))).toBeNull();
  });

  test("饼图只有一个分类轴与一个值通道", () => {
    expect(assignChannels("pie", pool(["org"], ["headcount", "attrition"]))).toEqual({
      x: "org",
      y: ["headcount"],
    });
    expect(assignChannels("pie", pool(["org", "level"], ["headcount"]))).toBeNull();
  });

  test("没有度量就没有可画的值，任何形态都不成立", () => {
    expect(assignChannels("line", pool(["org"], []))).toBeNull();
    expect(assignChannels("bar", pool(["org"], []))).toBeNull();
  });

  test("已有绑定装得下就沿用；改拆分维度时分类轴自动让位", () => {
    const two = pool(["org", "level"], ["headcount"]);
    expect(assignChannels("bar", two, { x: "level", groupBy: "org" })).toEqual({
      x: "level",
      y: ["headcount"],
      groupBy: "org",
    });
    // 旧的 x 被拆分通道占走，分类轴改由余数承担，而不是两个通道指向同一维度
    expect(assignChannels("bar", two, { x: "org", groupBy: "org" })).toEqual({
      x: "level",
      y: ["headcount"],
      groupBy: "org",
    });
  });

  test("引用不存在的成员按未声明处理，装箱仍给出合法分配", () => {
    expect(assignChannels("bar", pool(["org"], ["headcount"]), { x: "gone", y: ["gone"] })).toEqual(
      {
        x: "org",
        y: ["headcount"],
      },
    );
  });

  test("拆分候选只列装得下的维度：唯一候选即无可选之事", () => {
    expect(splitCandidates("bar", pool(["org", "level"], ["headcount"]))).toEqual(["org", "level"]);
    expect(splitCandidates("bar", pool(["org"], ["headcount"]))).toEqual([]);
    expect(splitCandidates("line", pool(["org"], ["headcount"]))).toEqual(["org"]);
    expect(splitCandidates("pie", pool(["org"], ["headcount"]))).toEqual([]);
  });
});

describe("第二把尺子", () => {
  const scales = {
    headcount: "number",
    hires: "number",
    attrition: "percent",
    gap: "percentage_point",
  };
  const mixed = { ...pool([], ["headcount", "attrition", "hires"]), scales };

  test("两种量纲缺省量在左、率在右；一种量纲全在左，不开副轴", () => {
    expect(assignChannels("line", mixed)).toEqual({ y: ["headcount", "hires"], y2: ["attrition"] });
    expect(assignChannels("line", { ...pool([], ["headcount", "hires"]), scales })).toEqual({
      y: ["headcount", "hires"],
    });
    // 量在左不看声明顺序：率排在前面也不占左
    expect(assignChannels("line", { ...pool([], ["attrition", "headcount"]), scales })).toEqual({
      y: ["headcount"],
      y2: ["attrition"],
    });
    // 没有 number 时首个量纲占左
    expect(assignChannels("line", { ...pool([], ["attrition", "gap"]), scales })).toEqual({
      y: ["attrition"],
      y2: ["gap"],
    });
  });

  test("声明的副轴装得下就沿用：同量纲也可硬拆两侧", () => {
    // 只声明副轴时主系列仍是全部度量；量放右轴留下的左侧混了两种量纲，按缺省分侧
    expect(assignChannels("line", mixed, { y2: ["hires"] })).toEqual({
      y: ["headcount", "hires"],
      y2: ["attrition"],
    });
    expect(
      assignChannels("line", { ...pool([], ["headcount", "hires"]), scales }, { y2: ["hires"] }),
    ).toEqual({ y: ["headcount"], y2: ["hires"] });
    // 声明违反「每侧一种量纲」时按缺省分侧，不照抄
    expect(assignChannels("bar", { ...mixed, dimensions: ["org"] }, { y2: ["headcount"] })).toEqual(
      {
        x: "org",
        y: ["headcount", "hires"],
        y2: ["attrition"],
      },
    );
  });

  test("三种量纲无解；拆分在场只剩一个系列因而没有副轴；饼图与指标卡只有一把尺子", () => {
    expect(
      assignChannels("line", { ...pool([], ["headcount", "attrition", "gap"]), scales }),
    ).toBeNull();
    expect(assignChannels("line", { ...mixed, dimensions: ["org"] })).toEqual({
      y: ["headcount"],
      groupBy: "org",
    });
    expect(assignChannels("pie", { ...mixed, dimensions: ["org"] })).toEqual({
      x: "org",
      y: ["headcount"],
    });
    expect(assignChannels("kpi", mixed)).toEqual({ y: ["headcount", "attrition", "hires"] });
  });

  test("y 与 y2 一起决定上轴的系列，副轴成员不必重复写进 y", () => {
    expect(assignChannels("line", mixed, { y: ["headcount"], y2: ["attrition"] })).toEqual({
      y: ["headcount"],
      y2: ["attrition"],
    });
  });
});
