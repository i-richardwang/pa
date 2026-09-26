import type { ReactNode } from "react";
import type { RouteKey } from "../router";

/** 导航与命令面板共用的条目类型。 */
export type NavEntry = { key: RouteKey; label: string; icon?: ReactNode };
