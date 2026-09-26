import { describe, expect, test } from "bun:test";
import { isAllowedOrigin, isLocalOrigin, normalizeAllowedOrigins } from "./origins.js";

describe("Origin 校验", () => {
  test("未配置时只允许 loopback 地址", () => {
    expect(isLocalOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalOrigin("http://[::1]:3000")).toBe(true);
    expect(isLocalOrigin("https://10.2.3.4")).toBe(false);
    expect(isLocalOrigin("http://192.168.1.20:5173")).toBe(false);
    expect(isLocalOrigin("https://172.31.0.9")).toBe(false);
    expect(isLocalOrigin("http://10.999.1.1")).toBe(false);
    expect(isLocalOrigin("https://example.com")).toBe(false);
  });

  test("其他来源需要显式配置，并按完整 origin 精确匹配", () => {
    const configured = normalizeAllowedOrigins(
      "https://pa.example, http://console.example:5173, https://pa.example",
    );
    expect(configured).toEqual(["https://pa.example", "http://console.example:5173"]);
    expect(isAllowedOrigin("https://pa.example", configured)).toBe(true);
    expect(isAllowedOrigin("https://other.example", configured)).toBe(false);
  });

  test("配置值带路径或凭证时报错", () => {
    expect(() => normalizeAllowedOrigins("https://pa.example/path")).toThrow("只接受 origin");
    expect(() => normalizeAllowedOrigins("https://user@pa.example")).toThrow("只接受 origin");
  });
});
