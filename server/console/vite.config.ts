import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// 服务端用 c.html 整页返回，资源全部内联进单个 HTML。
// singlefile 插件每次只构建一个入口：package.json 的 build:console 先构建登录页（清空 dist/），
// 再用 --mode dashboard 构建控制台，两次顺序不能调换。
export default defineConfig(({ mode }) => {
  const dashboard = mode === "dashboard";
  return {
    plugins: [react(), tailwindcss(), viteSingleFile()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@contracts": path.resolve(import.meta.dirname, "../src/contracts"),
        "@payload": path.resolve(import.meta.dirname, "../src/semantic_core/query_payload.ts"),
        "@charts": path.resolve(import.meta.dirname, "../src/presentation_core/chart_config.ts"),
        "@chart-spec": path.resolve(import.meta.dirname, "../src/presentation_core/chart_spec.ts"),
        "@channels": path.resolve(
          import.meta.dirname,
          "../src/presentation_core/chart_channels.ts",
        ),
        "@shape": path.resolve(import.meta.dirname, "../src/presentation_core/view_shape.ts"),
        "@format": path.resolve(import.meta.dirname, "../src/presentation_core/view_format.ts"),
        "@member": path.resolve(import.meta.dirname, "../src/semantic_core/member_name.ts"),
        "@time": path.resolve(import.meta.dirname, "../src/semantic_core/time_contract.ts"),
        "@query-feasibility": path.resolve(
          import.meta.dirname,
          "../src/semantic_core/query_feasibility.ts",
        ),
        "@canonical-json": path.resolve(
          import.meta.dirname,
          "../src/semantic_core/canonical_json.ts",
        ),
        "@semantic-analysis": path.resolve(
          import.meta.dirname,
          "../src/semantic_core/semantic_analysis.ts",
        ),
        "@view-preferences": path.resolve(
          import.meta.dirname,
          "../src/presentation_core/view_preferences.ts",
        ),
        "@data-capability-map": path.resolve(
          import.meta.dirname,
          "../src/presentation_core/data_capability_map.ts",
        ),
      },
    },
    build: {
      target: "es2022",
      // 令牌使用 light-dark()：基线低于原生支持版本时 lightningcss 会把它降级成只跟随系统 prefers-color-scheme 的媒体查询；与 widget/vite.config.ts 同改
      cssTarget: ["chrome123", "safari17.5", "firefox120"],
      chunkSizeWarningLimit: 2048,
      emptyOutDir: !dashboard,
      rollupOptions: {
        input: path.resolve(import.meta.dirname, dashboard ? "dashboard.html" : "index.html"),
      },
    },
  };
});
