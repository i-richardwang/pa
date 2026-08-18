/** 当前明暗档：初值读宿主主题，随宿主翻 data-theme 或系统翻 prefers-color-scheme 更新。 */
import { useEffect, useState } from "react";
import { isDarkTheme, watchTheme } from "./chart_render.js";

export function useDarkTheme(): boolean {
  const [dark, setDark] = useState(isDarkTheme);
  useEffect(() => watchTheme(() => setDark(isDarkTheme())), []);
  return dark;
}
