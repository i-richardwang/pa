/**
 * 复制成功后短暂返回 isCopied。局域网 HTTP 不一定暴露 Clipboard API，
 * 非安全上下文使用隐藏 textarea + execCommand 完成复制。
 */
import * as React from "react";

function fallbackCopy(value: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    ta.remove();
  }
  return ok;
}

export function useCopyToClipboard({
  timeout = 2000,
  onCopy,
}: {
  timeout?: number;
  onCopy?: () => void;
} = {}): { copyToClipboard: (value: string) => void; isCopied: boolean } {
  const [isCopied, setIsCopied] = React.useState(false);
  const timeoutIdRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const markCopied = (): void => {
    if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
    setIsCopied(true);
    onCopy?.();
    if (timeout !== 0) {
      timeoutIdRef.current = setTimeout(() => {
        setIsCopied(false);
        timeoutIdRef.current = null;
      }, timeout);
    }
  };

  const copyToClipboard = (value: string): void => {
    if (typeof window === "undefined" || !value) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(markCopied, () => {
        if (fallbackCopy(value)) markCopied();
      });
      return;
    }
    if (fallbackCopy(value)) markCopied();
  };

  React.useEffect(() => {
    return (): void => {
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
    };
  }, []);

  return { copyToClipboard, isCopied };
}
