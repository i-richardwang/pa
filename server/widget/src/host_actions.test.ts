import { describe, expect, test } from "bun:test";
import type { McpUiDownloadFileRequest } from "@modelcontextprotocol/ext-apps";
import type { ExportResourceLink } from "@payload";
import { deliverExport, resolveExportDelivery, type ExportHost } from "./host_actions.js";

const RESOURCE: ExportResourceLink = {
  type: "resource_link",
  uri: "pa://export/e_abcdefghijklmnopqrstuvwxyz012345",
  name: "pa_export.csv",
  mimeType: "text/csv; charset=utf-8",
};

function host(overrides: Partial<ExportHost> = {}): ExportHost {
  return {
    getHostCapabilities: () => ({}),
    downloadFile: async (_params: McpUiDownloadFileRequest["params"]) => ({}),
    ...overrides,
  };
}

describe("deliverExport", () => {
  test("能力协商只在 downloadFile 与 resource_link 同时存在时声明下载", () => {
    expect(
      resolveExportDelivery(
        host({
          getHostCapabilities: () => ({ downloadFile: {}, openLinks: {} }),
        }),
        RESOURCE,
      ),
    ).toBe("download_file");
    expect(
      resolveExportDelivery(
        host({
          getHostCapabilities: () => ({ openLinks: {} }),
        }),
        RESOURCE,
      ),
    ).toBeUndefined();
    expect(
      resolveExportDelivery(
        host({
          getHostCapabilities: () => ({ downloadFile: {} }),
        }),
        undefined,
      ),
    ).toBeUndefined();
    expect(resolveExportDelivery(host(), RESOURCE)).toBeUndefined();
  });

  test("宿主支持文件下载时直接提交 resource_link", async () => {
    let received: McpUiDownloadFileRequest["params"] | undefined;
    await deliverExport(
      host({
        getHostCapabilities: () => ({ downloadFile: {}, openLinks: {} }),
        downloadFile: async (params) => {
          received = params;
          return {};
        },
      }),
      RESOURCE,
    );
    expect(received).toEqual({ contents: [RESOURCE] });
  });

  test("下载动作缺少 resource_link 时明确失败", async () => {
    await expect(deliverExport(host(), undefined)).rejects.toThrow("没有提供下载链接");
  });

  test("下载被拒绝时向界面报错", async () => {
    await expect(
      deliverExport(
        host({
          getHostCapabilities: () => ({ downloadFile: {} }),
          downloadFile: async () => ({ isError: true }),
        }),
        RESOURCE,
      ),
    ).rejects.toThrow("被拒绝或已取消");
  });
});
