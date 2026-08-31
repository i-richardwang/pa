import { useSyncExternalStore } from "react";
import { subscribeTheme, themeSnapshot } from "./theme_store.js";

export function useDarkTheme(): boolean {
  return useSyncExternalStore(subscribeTheme, themeSnapshot, () => false);
}
