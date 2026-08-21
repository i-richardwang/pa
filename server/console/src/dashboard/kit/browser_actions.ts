import type { CardActions } from "pa-result-view";

/**
 * 浏览器宿主给结果面的环境动作：导出走新标签页打开签名链接（不把「打开链接」伪装成下载），
 * 复制走原生剪贴板。控制台里每个挂结果面的地方用的都是这一份；全屏不注入——网页宿主的
 * 形态由场景定，不靠 requestFullscreen。
 */
export const BROWSER_CARD_ACTIONS: CardActions = {
  exportAction: {
    kind: "open_link",
    run: async (link) => {
      window.open(link.url, "_blank", "noopener");
    },
  },
  copyText: async (text) => navigator.clipboard.writeText(text),
};
