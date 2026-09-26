/**
 * 只有宿主声明支持标准文件下载、且结果带 resource_link 时，结果卡才提供导出操作；
 * 不用打开外链代替下载。
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
  if (!resource) throw new Error("查询结果没有提供下载链接。");
  const result = await host.downloadFile({ contents: [resource] });
  if (result.isError) throw new Error("下载被拒绝或已取消。");
}
