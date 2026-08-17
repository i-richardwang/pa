/**
 * 宿主下载能力协商：只有宿主明确声明标准下载能力且结果带 resource_link 时，
 * 才向 MCP Preview 注入导出动作；外链导航不是文件下载退路。
 */
import type {
  McpUiDownloadFileRequest,
  McpUiHostCapabilities,
} from "@modelcontextprotocol/ext-apps";
import type { ExportResourceLink } from "@payload";

export type ExportHost = {
  getHostCapabilities: () => McpUiHostCapabilities | undefined;
  downloadFile: (params: McpUiDownloadFileRequest["params"]) => Promise<{ isError?: boolean }>;
};

export type ExportDelivery = "download_file";

export function resolveExportDelivery(
  host: Pick<ExportHost, "getHostCapabilities">,
  resource: ExportResourceLink | undefined,
): ExportDelivery | undefined {
  const capabilities = host.getHostCapabilities();
  if (capabilities?.downloadFile && resource) return "download_file";
  return undefined;
}

export async function deliverExport(
  host: ExportHost,
  resource: ExportResourceLink | undefined,
): Promise<void> {
  if (!resource) throw new Error("查询结果没有提供可下载的 MCP ResourceLink。");
  const result = await host.downloadFile({ contents: [resource] });
  if (result.isError) throw new Error("宿主拒绝或取消了文件下载。");
}
