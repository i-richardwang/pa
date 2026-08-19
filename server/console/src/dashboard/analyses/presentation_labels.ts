import type { ReportDetail } from "@contracts/report_contract";

export const PRESENTATION_TYPE_LABELS: Record<ReportDetail["presentation_type"], string> = {
  table: "表格",
  kpi: "指标卡",
  line: "折线图",
  bar: "柱状图",
  pie: "饼图",
};
