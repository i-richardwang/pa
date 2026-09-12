import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";

/** 提示级别到图标：操作回执与页内提示条共用这一套。 */
export const STATUS_ICONS = {
  error: CircleAlertIcon,
  info: InfoIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
} as const;

export type StatusLevel = keyof typeof STATUS_ICONS;
