import type { ExportLink } from "../../../src/semantic_core/query_payload.js";

/**
 * 环境动作注入：共享渲染组件只声明需要的宿主能力，不感知 MCP bridge 或浏览器实现。
 * 动作收到的只有载荷里的事实（导出票据）；宿主自己那侧的句柄（MCP resource_link 等）
 * 由宿主在注入时闭包带上。
 */
export type CardActions = {
  /** 仅注入环境真实支持的导出动作；kind 决定入口名称，不把打开链接伪装成下载。 */
  exportAction?: {
    kind: "download_file" | "open_link";
    run: (link: ExportLink) => Promise<void>;
  };
  /** 环境提供可用的剪贴板写入时注入；缺省时不显示复制或手动链接入口。 */
  copyText?: (text: string) => Promise<void>;
  /** 请求全屏展示；环境不支持时不传，入口随之隐藏。 */
  requestFullscreen?: () => Promise<void>;
};
