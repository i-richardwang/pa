import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// 单文件内联：MCP Apps 沙箱 iframe 的 CSP 默认禁外链，全部 JS/CSS 打进一个 HTML
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    // 别名带 widget 前缀（不用裸 @），与外部宿主的 @ 不冲突；服务端共享件是唯一事实源。
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
    // 令牌靠 light-dark() 跟随宿主 color-scheme（applyDocumentTheme 主题翻转）；
    // 默认 cssTarget 会让 lightningcss 把它降级成只认 prefers-color-scheme 的
    // 媒体查询变量对，宿主暗色随即失效——钉住原生支持 light-dark 的基线
    cssTarget: ["chrome123", "safari17.5", "firefox120"],
    chunkSizeWarningLimit: 2048,
  },
});
