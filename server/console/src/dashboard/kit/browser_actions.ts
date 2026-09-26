import type { CardActions } from "pa-result-view";

/** 导出时在新标签页打开签名链接。 */
export const BROWSER_CARD_ACTIONS: CardActions = {
  exportAction: {
    kind: "open_link",
    run: async (link) => {
      window.open(link.url, "_blank", "noopener");
    },
  },
  copyText: async (text) => navigator.clipboard.writeText(text),
};
