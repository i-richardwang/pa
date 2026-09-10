/**
 * 命令面板跳入字典页时预填的搜索词：单次传递，读后即清。
 * 三张字典页各读一次同一个信箱——落地的只有被导航到的那一页。
 */
import { useState } from "react";

const PREFILL_KEY = "pa.catalog.q";

export function prefillCatalogSearch(keyword: string): void {
  sessionStorage.setItem(PREFILL_KEY, keyword);
}

export function usePrefilledKeyword(): [string, (next: string) => void] {
  const [keyword, setKeyword] = useState(() => {
    const prefill = sessionStorage.getItem(PREFILL_KEY) ?? "";
    sessionStorage.removeItem(PREFILL_KEY);
    return prefill;
  });
  return [keyword, setKeyword];
}
