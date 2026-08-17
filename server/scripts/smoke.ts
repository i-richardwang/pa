/** 以 MCP 客户端走通公开 Demo 的目录、候选值、分析与 App 资源。 */
import type { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PRODUCT_VERSION } from "../src/contracts/product_metadata.js";
import { CATALOG_OUTPUT_SCHEMA, RUN_OUTPUT_SCHEMA, UI_RESOURCE_URI } from "../src/mcp/contracts.js";

function firstText(result: unknown): string {
  const blocks = (result as { content?: { type: string; text?: string }[] }).content;
  const text = blocks?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("工具未返回文本内容");
  return text;
}

type CatalogResult = z.infer<typeof CATALOG_OUTPUT_SCHEMA>;
type RunResult = z.infer<typeof RUN_OUTPUT_SCHEMA>;
const endpoint = process.argv[2] ?? "http://127.0.0.1:8788/mcp";
const apiKey = process.env.PA_MCP_API_KEY;
const client = new Client({ name: "pa-public-smoke", version: PRODUCT_VERSION });
await client.connect(
  new StreamableHTTPClientTransport(
    new URL(endpoint),
    apiKey ? { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } } : undefined,
  ),
);

try {
  const tools = await client.listTools();
  for (const name of ["catalog", "values_of", "run_analysis", "show_analysis"]) {
    const tool = tools.tools.find((candidate) => candidate.name === name);
    if (!tool?.outputSchema) throw new Error(`MCP 工具缺失或没有 outputSchema：${name}`);
  }

  const catalog = CATALOG_OUTPUT_SCHEMA.parse(
    JSON.parse(
      firstText(await client.callTool({ name: "catalog", arguments: { terms: ["人员", "组织"] } })),
    ),
  ) as CatalogResult;
  if (catalog.default_population_scope !== "统计范围：公开虚构数据中的示例员工。") {
    throw new Error("公开 Demo 默认统计范围未从模型透传");
  }
  const member = (title: string, kind: "measure" | "dimension") => {
    const values = kind === "measure" ? catalog.measures : catalog.dimensions;
    const hit = values.find((candidate) => candidate.title === title);
    if (!hit) throw new Error(`catalog 未返回 ${kind}：${title}`);
    return hit.id;
  };
  const active = member("在职人数", "measure");
  const organization = member("组织", "dimension");

  const values = JSON.parse(
    firstText(
      await client.callTool({
        name: "values_of",
        arguments: { member: organization, contains: "Aurora" },
      }),
    ),
  ) as { values?: string[] };
  if (!values.values?.includes("Aurora Labs")) throw new Error("values_of 未返回虚构组织值");

  const run = RUN_OUTPUT_SCHEMA.parse(
    JSON.parse(
      firstText(
        await client.callTool({
          name: "run_analysis",
          arguments: {
            spec: {
              version: 2,
              analysis: {
                title: "公开 Demo 月末人员规模",
                views: [
                  {
                    id: "workforce",
                    measures: [active],
                    dimensions: [organization],
                    time: { window: { kind: "current_month" } },
                  },
                ],
              },
              presentation: { type: "table" },
            },
          },
        }),
      ),
    ),
  ) as RunResult;
  if (!run.view.rows.length || !run.view.columns.includes(active)) {
    throw new Error("run_analysis 未返回预期公开 Demo 结果");
  }

  const resource = await client.readResource({ uri: UI_RESOURCE_URI });
  const html = resource.contents[0];
  if (!html || !("text" in html) || html.mimeType !== "text/html;profile=mcp-app") {
    throw new Error("MCP App 结果预览资源不可用");
  }
  console.log(`公开 Demo MCP 冒烟通过：${run.view.rows.length} 行`);
} finally {
  await client.close();
}
