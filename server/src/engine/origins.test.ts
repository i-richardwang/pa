import { describe, expect, test } from "bun:test";
import { isAllowedOrigin, isLocalOrigin, normalizeAllowedOrigins } from "./origins.js";

describe("Origin 判据", () => {
  test("默认只放行 loopback", () => {
    expect(isLocalOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalOrigin("http://[::1]:3000")).toBe(true);
    expect(isLocalOrigin("https://10.2.3.4")).toBe(false);
    expect(isLocalOrigin("http://192.168.1.20:5173")).toBe(false);
    expect(isLocalOrigin("https://172.31.0.9")).toBe(false);
    expect(isLocalOrigin("http://10.999.1.1")).toBe(false);
    expect(isLocalOrigin("https://example.com")).toBe(false);
  });

  test("其他来源须显式配置且按完整 origin 精确匹配", () => {
    const configured = normalizeAllowedOrigins(
      "https://pa.example, http://console.example:5173, https://pa.example",
    );
    expect(configured).toEqual(["https://pa.example", "http://console.example:5173"]);
    expect(isAllowedOrigin("https://pa.example", configured)).toBe(true);
    expect(isAllowedOrigin("https://other.example", configured)).toBe(false);
  });

  test("拒绝把路径、查询或凭证误配成 origin", () => {
    expect(() => normalizeAllowedOrigins("https://pa.example/path")).toThrow("只接受 origin");
    expect(() => normalizeAllowedOrigins("https://user@pa.example")).toThrow("只接受 origin");
  });
});
