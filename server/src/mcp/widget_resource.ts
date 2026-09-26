import { readFile } from "node:fs/promises";
import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import type { McpRegistrationContext } from "./context.js";
import { safeMcpResourceHandler } from "./errors.js";
import {
  OPENAI_WIDGET_CSP,
  RECORDS_UI_RESOURCE_URI,
  UI_RESOURCE_META,
  UI_RESOURCE_URI,
} from "./contracts.js";

let htmlCache: string | undefined;

async function widgetHtml(mode: "analysis" | "records"): Promise<string> {
  const read = () =>
    readFile(new URL("../../widget/dist/index.html", import.meta.url), "utf8").catch(() => {
      throw new Error("预览资源未构建：先运行 bun run build:app");
    });
  let html: string;
  if (process.env.NODE_ENV !== "production") {
    html = await read();
  } else {
    htmlCache ??= await read();
    html = htmlCache;
  }
  return html.replace("<head>", `<head><meta name="pa-widget-mode" content="${mode}">`);
}

export function registerWidgetResource({ server }: McpRegistrationContext): void {
  registerAppResource(
    server,
    "query_result_view",
    UI_RESOURCE_URI,
    {
      description: "以指标卡、图表或表格展示查询结果、数据截至月和口径说明。",
      _meta: { ui: UI_RESOURCE_META },
    },
    safeMcpResourceHandler("query_result_view", async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await widgetHtml("analysis"),
          _meta: {
            ui: UI_RESOURCE_META,
            "openai/widgetDescription":
              "本卡片已呈现本次查询的完整结果、数据截至月和口径说明。" +
              "若用户未要求文本明细，通常无需在回复中逐项复述卡片数据；" +
              "请优先响应用户的具体要求，并按需补充结论、解释或提示。",
            "openai/widgetPrefersBorder": false,
            "openai/widgetCSP": OPENAI_WIDGET_CSP,
          },
        },
      ],
    })),
  );

  registerAppResource(
    server,
    "record_projection_view",
    RECORDS_UI_RESOURCE_URI,
    {
      description: "以表格展示组成指标结果的构成记录及相关字段。",
      _meta: { ui: UI_RESOURCE_META },
    },
    safeMcpResourceHandler("record_projection_view", async () => ({
      contents: [
        {
          uri: RECORDS_UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await widgetHtml("records"),
          _meta: {
            ui: UI_RESOURCE_META,
            "openai/widgetDescription":
              "本卡片已展示用户要求的构成记录。回复只需说明记录已打开，" +
              "不得复述姓名、工号或其他个体字段。",
            "openai/widgetPrefersBorder": false,
            "openai/widgetCSP": OPENAI_WIDGET_CSP,
          },
        },
      ],
    })),
  );
}
