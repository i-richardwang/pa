import { Avatar } from "@/components/ui/avatar";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type DependencyList,
  type ReactNode,
} from "react";

type SettingsChromeValue = { setActions: (actions: ReactNode | null) => void };

export const SettingsChromeContext = createContext<SettingsChromeValue>({ setActions: () => {} });

/**
 * 清单节把动作挂到弹层顶右（关闭钮左侧）。
 * 表单节不用它——那里的动作跟着题名块走，落在正文里。
 */
export function useSetSettingsActions(factory: () => ReactNode, deps: DependencyList): void {
  const { setActions } = useContext(SettingsChromeContext);
  const node = useMemo(factory, deps);
  useEffect(() => {
    setActions(node);
    return () => setActions(null);
  }, [node, setActions]);
}

/** 清单行首的圆形标识片：人给首字母，物给类型图标。 */
export function RowBadge({ children }: { children: ReactNode }) {
  return <Avatar aria-hidden="true">{children}</Avatar>;
}
