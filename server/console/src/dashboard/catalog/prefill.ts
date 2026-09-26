// 命令面板跳转到字典页时预填的搜索词，由目标页读取一次后清除。
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
