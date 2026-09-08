/**
 * 命令面板跳入字典页时预填搜索词：单次传递，读后即清。
 * 三张字典页各读一次同一个键——落地的只有被导航到的那一页。
 */
import { useState } from "react";
import { CATALOG_PREFILL_KEY } from "../layout/command_palette";

export function usePrefilledKeyword(): [string, (next: string) => void] {
  const [keyword, setKeyword] = useState(() => {
    const prefill = sessionStorage.getItem(CATALOG_PREFILL_KEY) ?? "";
    sessionStorage.removeItem(CATALOG_PREFILL_KEY);
    return prefill;
  });
  return [keyword, setKeyword];
}
