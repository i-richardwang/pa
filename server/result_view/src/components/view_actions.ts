import type { ExportLink, ExportResourceLink } from "../../../src/semantic_core/query_payload.js";

/**
 * 环境动作注入：共享渲染组件只声明需要的宿主能力，不感知 MCP bridge 或浏览器实现。
 */
export type CardActions = {
  /** 仅注入环境真实支持的导出动作；kind 决定入口名称，不把打开链接伪装成下载。 */
  exportAction?: {
    kind: "download_file" | "open_link";
    run: (link: ExportLink, resource?: ExportResourceLink) => Promise<void>;
  };
  /** 环境提供可用的剪贴板写入时注入；缺省时不显示复制或手动链接入口。 */
  copyText?: (text: string) => Promise<void>;
  /** 请求全屏展示；环境不支持时不传，入口随之隐藏。 */
  requestFullscreen?: () => Promise<void>;
};
