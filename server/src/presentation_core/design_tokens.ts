/** 明暗两套取值：序列化的 option 用 light，渲染端在暗色主题下按映射换成 dark */
export type TokenPair = { readonly light: string; readonly dark: string };

/** 图表系列色：序列化的 option 用 light，渲染端按 CHART_DARK_COLORS 换成 dark */
export const CHART_SERIES: readonly TokenPair[] = [
  { light: "#3b6fdb", dark: "#5b8def" },
  { light: "#e0857a", dark: "#e8998f" },
  { light: "#3fa08f", dark: "#4fb8a5" },
  { light: "#a97fd4", dark: "#b894e0" },
  { light: "#e0b451", dark: "#e8c470" },
  { light: "#6a9e58", dark: "#7fb56c" },
  { light: "#4d9dc4", dark: "#63b0d6" },
  { light: "#8c7b6b", dark: "#a08e7d" },
] as const;

export const CHART_CHROME = {
  /** 轴刻度，与 --pa-faint 同值 */
  axisText: { light: "#aaaaaa", dark: "#6e6e6e" },
  /** 数值标签，与 --pa-muted 同值 */
  valueText: { light: "#767676", dark: "#a3a3a3" },
  /** 横纵虚线网格 */
  gridLine: { light: "#e8e8e8", dark: "#2b2b2b" },
  /** 时间桶边界的分隔线，颜色比网格线深 */
  gridEdge: { light: "rgba(0, 0, 0, 0.15)", dark: "rgba(255, 255, 255, 0.16)" },
  /** 图表背景色，也用于饼图切缝和需要遮挡的底色 */
  surface: { light: "#ffffff", dark: "#171717" },
  /** 数值标签的底色；描边用 surface */
  labelChip: { light: "#f7f7f8", dark: "#232323" },

  pointerBand: { light: "rgba(0, 0, 0, 0.04)", dark: "rgba(255, 255, 255, 0.07)" },
  /** 纯折线图的指针竖虚线，与 --pa-muted 同值 */
  pointerLine: { light: "#767676", dark: "#a3a3a3" },

  blurred: { light: "#dedede", dark: "#3a3a3a" },
} as const satisfies Record<string, TokenPair>;

/** 数字和拉丁字母用 Inter，中文用系统字体；须与 tokens.css 的 --font-sans 一致 */
export const FONT_FAMILY =
  "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";

/**
 * UI 语义令牌，须与 tokens.css :root 同值（design_tokens.test.ts 对照）；明暗不变的令牌 light 与 dark 相同。
 * 键名是 CSS 变量名去掉 `--pa-` 前缀。
 */
export const UI_TOKENS: Record<string, TokenPair> = {
  page: { light: "#ffffff", dark: "#0f0f0f" },
  bg: { light: "#ffffff", dark: "#171717" },
  canvas: { light: "#f7f7f8", dark: "#0f0f0f" },
  fg: { light: "#191919", dark: "#ededed" },
  muted: { light: "#767676", dark: "#a3a3a3" },
  faint: { light: "#aaaaaa", dark: "#6e6e6e" },
  "fg-soft": { light: "#4c4c4c", dark: "#c9c9c9" },
  "disabled-fg": { light: "rgba(0, 0, 0, 0.2)", dark: "rgba(255, 255, 255, 0.22)" },
  placeholder: { light: "#c4c4c4", dark: "#5e5e5e" },
  line: { light: "rgba(0, 0, 0, 0.09)", dark: "rgba(255, 255, 255, 0.1)" },
  "line-strong": { light: "#d2d2d2", dark: "#3f3f3f" },
  "line-hover": { light: "rgba(0, 0, 0, 0.15)", dark: "rgba(255, 255, 255, 0.16)" },
  "line-subtle": { light: "#f2f2f2", dark: "#212121" },
  surface: { light: "rgba(0, 0, 0, 0.04)", dark: "rgba(255, 255, 255, 0.07)" },
  wash: { light: "rgba(25, 25, 25, 0.02)", dark: "rgba(255, 255, 255, 0.04)" },
  "wash-solid": { light: "#fafafa", dark: "#1f1f1f" },
  ink: { light: "#191919", dark: "#ededed" },
  "ink-fg": { light: "#ffffff", dark: "#171717" },
  accent: { light: "#3b6fdb", dark: "#5b8def" },
  "focus-strong": { light: "#7eaff7", dark: "#5b8def" },
  "focus-ring": { light: "rgba(67, 138, 232, 0.15)", dark: "rgba(91, 141, 239, 0.25)" },
  highlight: { light: "#438ae8", dark: "#5b8def" },
  "highlight-bg": { light: "#e9f1fe", dark: "#24344d" },
  "login-input-border": { light: "#d1d1d1", dark: "#3f3f3f" },
  "login-label": { light: "#838383", dark: "#a3a3a3" },
  danger: { light: "#b42318", dark: "#b42318" },
  "danger-fg": { light: "#b42318", dark: "#f97066" },
  success: { light: "#3d9a5f", dark: "#3d9a5f" },
  "success-fg": { light: "#2f7a4a", dark: "#5cbd82" },
  warning: { light: "#d99b1f", dark: "#d99b1f" },
  "warning-fg": { light: "#96620f", dark: "#f5c451" },
  "info-fg": { light: "#3b6fdb", dark: "#5b8def" },
  shadow: { light: "rgba(25, 25, 25, 0.12)", dark: "rgba(0, 0, 0, 0.4)" },
  dimmer: { light: "rgba(10, 10, 10, 0.1)", dark: "rgba(0, 0, 0, 0.4)" },
  glass: { light: "rgba(255, 255, 255, 0.8)", dark: "rgba(38, 38, 38, 0.8)" },
  "glass-popover": { light: "rgba(255, 255, 255, 0.75)", dark: "rgba(38, 38, 38, 0.75)" },
  avatar: { light: "#e9f1fe", dark: "#24344d" },
  "tooltip-bg": { light: "#191919", dark: "#2e2e2e" },
};

export const TABLE_SHADING_TOKENS = {
  surface: UI_TOKENS.bg,
  palettes: {
    traffic_lights: {
      label: "红黄绿",
      stops: [
        { light: "#e0857a", dark: "#e8998f" },
        { light: "#f5e6a3", dark: "#5c4a12" },
        { light: "#3fa08f", dark: "#4fb8a5" },
      ],
    },
    red_blue: {
      label: "红蓝",
      stops: [
        { light: "#f25494", dark: "#f25494" },
        { light: "#f7e5ff", dark: "#34004d" },
        { light: "#91a1ff", dark: "#91a1ff" },
      ],
    },
    viridis: {
      label: "翠绿",
      stops: [
        { light: "#fff6a5", dark: "#5b1f6a" },
        { light: "#4da198", dark: "#4da198" },
        { light: "#5b1f6a", dark: "#fff6a5" },
      ],
    },
    magma: {
      label: "熔岩",
      stops: [
        { light: "#fcfdbf", dark: "#1b1b79" },
        { light: "#d65b8f", dark: "#d65b8f" },
        { light: "#1b1b79", dark: "#fcfdbf" },
      ],
    },
  },
} as const;
