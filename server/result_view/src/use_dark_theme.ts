import { useEffect, useState } from "react";
import { isDarkTheme, watchTheme } from "./chart_render.js";

export function useDarkTheme(): boolean {
  const [dark, setDark] = useState(isDarkTheme);
  useEffect(() => watchTheme(() => setDark(isDarkTheme())), []);
  return dark;
}
