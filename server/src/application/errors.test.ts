import { describe, expect, test } from "bun:test";
import { CubeGatewayError } from "../ports/cube_gateway.js";
import { AnalysisDefinitionError } from "../semantic_core/semantic_analysis.js";
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
  });
});
