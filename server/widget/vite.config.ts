import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// 单文件内联：MCP Apps 沙箱 iframe 的 CSP 默认禁外链，全部 JS/CSS 打进一个 HTML
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    // 用 @widget 前缀而非裸 @，避免与外部宿主的 @ 别名冲突
    alias: {
      "@widget": path.resolve(import.meta.dirname, "src"),
      "@payload": path.resolve(import.meta.dirname, "../src/semantic_core/query_payload.ts"),
      "@records": path.resolve(
        import.meta.dirname,
        "../src/contracts/record_projection_contract.ts",
      ),
      "@charts": path.resolve(import.meta.dirname, "../src/presentation_core/chart_config.ts"),
      "@presentation-guard": path.resolve(
        import.meta.dirname,
        "../src/presentation_core/presentation_guard.ts",
      ),
      "@product": path.resolve(import.meta.dirname, "../src/contracts/product_metadata.ts"),
    },
  },
  build: {
    target: "es2022",
    // 令牌用 light-dark() 跟随宿主 color-scheme；默认 cssTarget 下 lightningcss 会把它降级为
    // prefers-color-scheme 媒体查询，宿主设置的暗色随之失效，所以指定原生支持 light-dark 的基线
    cssTarget: ["chrome123", "safari17.5", "firefox120"],
    chunkSizeWarningLimit: 2048,
  },
});
