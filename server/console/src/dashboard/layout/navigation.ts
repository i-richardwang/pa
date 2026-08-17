import type { ReactNode } from "react";
import type { RouteKey } from "../router";

/** 导航与命令面板共用的最小条目合同。 */
export type NavEntry = { key: RouteKey; label: string; icon?: ReactNode };
