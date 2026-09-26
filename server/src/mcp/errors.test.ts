import { describe, expect, test } from "bun:test";
import { InvalidRequestError } from "../application/errors.js";
import { TimeSelectionError, timeSelectionIssueMessage } from "../semantic_core/time_contract.js";
import { recordingLogger } from "../test_support/logger.js";
import { safeMcpResourceHandler, safeMcpToolHandler } from "./errors.js";

describe("MCP outer error boundary", () => {
  test("可恢复的问题以机器可读的 MCP 错误结果返回", async () => {
    const issue = {
      code: "metric_time_grain_incompatible" as const,
      metric_titles: ["月度入职率"],
      required_grain: "month" as const,
      selected_grain: "year" as const,
    };
    const logger = recordingLogger();
    const invalid = safeMcpToolHandler(logger, "run_analysis", async () => {
      throw new TimeSelectionError(issue);
    });
    const message = timeSelectionIssueMessage(issue);

    const result = await invalid();
    expect(result.isError).toBe(true);
    expect(result).not.toHaveProperty("structuredContent");
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: {
        code: "invalid_request",
        message,
        details: { issue },
      },
    });
    expect(logger.entries).toEqual([]);
  });

  test("工具与资源共用安全分类，未知异常不进入公共结果", async () => {
    const logger = recordingLogger();
    const invalidResource = safeMcpResourceHandler(logger, "invalid_resource", async () => {
      throw new InvalidRequestError("请求需要修改");
    });
    await expect(invalidResource()).rejects.toThrow("请求需要修改");

    const failure = new Error("SQLITE_CANTOPEN /private/path");
    const internal = safeMcpToolHandler(logger, "internal", async () => {
      throw failure;
    });
    const result = await internal();
    expect(result.isError).toBe(true);
    expect(result).not.toHaveProperty("structuredContent");
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: { code: "internal", message: "服务暂时无法完成请求，请稍后重试" },
    });
    expect(JSON.stringify(result)).not.toContain("SQLITE_CANTOPEN");
    expect(JSON.stringify(result)).not.toContain("/private/path");
    expect(logger.entries).toEqual([
      { level: "error", message: "MCP internal 失败", error: failure },
    ]);
  });
});
