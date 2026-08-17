export const REPORT_CALCULATION_KINDS = ["percent_of_total"] as const;

export type ReportCalculationKind = (typeof REPORT_CALCULATION_KINDS)[number];
