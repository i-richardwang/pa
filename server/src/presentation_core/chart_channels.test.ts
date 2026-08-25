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
