import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// 单文件内联：页面由服务端整页返回（c.html），免去静态资源路由。
// singlefile 插件一次只出一个入口，双页面跑两次构建（--mode dashboard 出控制台，
// 默认出登录页；顺序固定登录页在先，见根 package.json 的 build:console），产物共存于 dist/。
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
        "@shape": path.resolve(import.meta.dirname, "../src/presentation_core/view_shape.ts"),
        "@format": path.resolve(import.meta.dirname, "../src/presentation_core/view_format.ts"),
        "@member": path.resolve(import.meta.dirname, "../src/semantic_core/member_name.ts"),
        "@time": path.resolve(import.meta.dirname, "../src/semantic_core/time_contract.ts"),
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
      // 复用的结果卡令牌用 light-dark()（与 widget 同源），钉住原生支持基线防 lightningcss
      // 降级成只认系统 prefers 的媒体查询（见 widget/vite.config.ts 同注）
      cssTarget: ["chrome123", "safari17.5", "firefox120"],
      chunkSizeWarningLimit: 2048,
      emptyOutDir: !dashboard,
      rollupOptions: {
        input: path.resolve(import.meta.dirname, dashboard ? "dashboard.html" : "index.html"),
      },
    },
  };
});
