type Listener = () => void;

const listeners = new Set<Listener>();
let current = false;
let stopWatching: (() => void) | null = null;

function readTheme(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  const theme = document.documentElement.dataset.theme;
  if (theme) return theme === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function refresh(): void {
  const next = readTheme();
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function startWatching(): void {
  if (stopWatching || typeof document === "undefined" || typeof window === "undefined") return;
  current = readTheme();
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener("change", refresh);
  stopWatching = () => {
    observer.disconnect();
    media?.removeEventListener("change", refresh);
    stopWatching = null;
  };
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startWatching();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopWatching?.();
  };
}

export function themeSnapshot(): boolean {
  if (!stopWatching) current = readTheme();
  return current;
}
