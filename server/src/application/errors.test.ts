import { describe, expect, test } from "bun:test";
import { CubeGatewayError } from "../ports/cube_gateway.js";
import { AnalysisDefinitionError } from "../semantic_core/semantic_analysis.js";
import { TimeSelectionError, timeSelectionIssueMessage } from "../semantic_core/time_contract.js";
import { InvalidRequestError, publicApplicationError } from "./errors.js";

describe("application error boundary", () => {
  test("只公开稳定分类与安全消息", () => {
    expect(publicApplicationError(new InvalidRequestError("请补齐指标"))).toMatchObject({
      code: "invalid_request",
      message: "请补齐指标",
      status: 400,
      internal: false,
    });
    expect(publicApplicationError(new CubeGatewayError("数据引擎暂时不可用"))).toMatchObject({
      code: "unavailable",
      message: "数据引擎暂时不可用",
      status: 503,
      internal: true,
    });
    expect(publicApplicationError(new Error("SQLITE_CANTOPEN /private/path"))).toMatchObject({
      code: "internal",
      message: "服务暂时无法完成请求，请稍后重试",
      status: 500,
      internal: true,
    });
    expect(publicApplicationError(new AnalysisDefinitionError("分析定义需要修改"))).toMatchObject({
      code: "invalid_request",
      message: "分析定义需要修改",
      status: 400,
      internal: false,
    });
    const issue = {
      code: "metric_time_grain_incompatible" as const,
      metric_titles: ["月度入职率"],
      required_grain: "month" as const,
      selected_grain: "year" as const,
    };
    expect(publicApplicationError(new TimeSelectionError(issue))).toMatchObject({
      code: "invalid_request",
      message: timeSelectionIssueMessage(issue),
      status: 400,
      details: { issue },
      internal: false,
    });
    const overlap = {
      code: "time_output_bucket_overlap" as const,
      selected_grain: "year" as const,
      bucket: "2022",
    };
    expect(publicApplicationError(new TimeSelectionError(overlap))).toMatchObject({
      code: "invalid_request",
      message: timeSelectionIssueMessage(overlap),
      status: 400,
      details: { issue: overlap },
      internal: false,
    });
    const calendarYearTotal = {
      code: "metric_time_calendar_year_total_incompatible" as const,
      metric_titles: ["YTD事件率"],
      from: "2025-01",
      to: "2026-07",
      selected_grain: "total" as const,
    };
    expect(publicApplicationError(new TimeSelectionError(calendarYearTotal))).toMatchObject({
      code: "invalid_request",
      message: timeSelectionIssueMessage(calendarYearTotal),
      status: 400,
      details: { issue: calendarYearTotal },
      internal: false,
    });
  });
});
