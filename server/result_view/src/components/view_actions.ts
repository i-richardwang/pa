import type { ExportLink } from "../../../src/semantic_core/query_payload.js";

/**
 * 宿主注入的操作。共享渲染组件只声明需要哪些宿主能力，不依赖 MCP bridge 或浏览器的具体实现。
 * 操作只接收结果里的数据（导出票据）；宿主侧需要的句柄（如 MCP resource_link）由宿主在注入时通过闭包带入。
 */
export type CardActions = {
  /** 只注入宿主确实支持的导出方式；kind 决定按钮文字（下载文件或打开链接）。 */
  exportAction?: {
    kind: "download_file" | "open_link";
    run: (link: ExportLink) => Promise<void>;
  };
  /** 宿主能写剪贴板时注入；不传时不显示复制链接的入口。 */
  copyText?: (text: string) => Promise<void>;
  /** 请求全屏显示；宿主不支持时不传，入口随之隐藏。 */
  requestFullscreen?: () => Promise<void>;
};
