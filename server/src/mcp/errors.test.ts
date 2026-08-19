import { describe, expect, spyOn, test } from "bun:test";
import { InvalidRequestError } from "../application/errors.js";
import { safeMcpHandler } from "./errors.js";

describe("MCP outer error boundary", () => {
  test("保留预期错误消息并脱敏未知异常", async () => {
    const invalid = safeMcpHandler("invalid", async () => {
      throw new InvalidRequestError("请求需要修改");
    });
    await expect(invalid()).rejects.toThrow("请求需要修改");

    const logged = spyOn(console, "error").mockImplementation(() => undefined);
    const internal = safeMcpHandler("internal", async () => {
      throw new Error("SQLITE_CANTOPEN /private/path");
    });
    try {
      await expect(internal()).rejects.toThrow("服务暂时无法完成请求，请稍后重试");
      expect(logged).toHaveBeenCalledWith("[pa] MCP internal 失败:", expect.any(Error));
    } finally {
      logged.mockRestore();
    }
  });
});
