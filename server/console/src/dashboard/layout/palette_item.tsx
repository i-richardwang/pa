/**
 * 命令面板的条目词表：一种条目一行，各自交代可搜文本、标签、身份、图标与类型提示。
 */
import {
  ArrowRightIcon,
  BookOpenIcon,
  ChartBarIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  MessageSquareQuoteIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";
import { DiamondFilled, DiamondOutline } from "../analyses/member_picker";
import type { RouteKey } from "../router";

export type PaletteItem =
  | { kind: "action"; label: string; hash: string }
  | { kind: "nav"; key: RouteKey; label: string }
  | { kind: "settings" }
  | { kind: "board"; id: string; name: string }
  | { kind: "report"; id: string; name: string }
  | { kind: "analysis"; id: string; title: string }
  | { kind: "member"; name: string; title: string; memberKind: "measure" | "dimension" }
  | { kind: "metric_domain"; id: string; title: string; synonyms: string[] }
  | {
      kind: "business_term";
      id: string;
      canonicalTerm: string;
      aliases: string[];
      definition: string;
    };

/** 可搜文本：黑话（域别名、术语别名）与语义 id 都算数，标签只印业务名。 */
export function itemText(item: PaletteItem): string {
  switch (item.kind) {
    case "action":
      return item.label;
    case "nav":
      return item.label;
    case "settings":
      return "设置";
    case "board":
      return item.name;
    case "report":
      return item.name;
    case "analysis":
      return item.title;
    case "member":
      return `${item.title} ${item.name}`;
    case "metric_domain":
      return `${item.title} ${item.synonyms.join(" ")}`;
    case "business_term":
      return `${item.canonicalTerm} ${item.aliases.join(" ")} ${item.definition}`;
  }
}

export function itemLabel(item: PaletteItem): string {
  if (item.kind === "member" || item.kind === "metric_domain") return item.title;
  if (item.kind === "business_term") return item.canonicalTerm;
  return itemText(item);
}

export function itemKey(item: PaletteItem): string {
  switch (item.kind) {
    case "action":
      return `action:${item.hash}`;
    case "nav":
      return `nav:${item.key}`;
    case "settings":
      return "settings";
    case "board":
      return `board:${item.id}`;
    case "report":
      return `report:${item.id}`;
    case "analysis":
      return `analysis:${item.id}`;
    case "member":
      return `member:${item.name}`;
    case "metric_domain":
      return item.id;
    case "business_term":
      return `business_term:${item.id}`;
  }
}

export function itemIcon(item: PaletteItem): React.ReactElement {
  switch (item.kind) {
    case "action":
      return <PlusIcon />;
    case "nav":
      return <ArrowRightIcon />;
    case "settings":
      return <SettingsIcon />;
    case "board":
      return <LayoutDashboardIcon />;
    case "report":
      return <ChartBarIcon />;
    case "analysis":
      return <HistoryIcon />;
    case "member":
      return item.memberKind === "measure" ? <DiamondFilled /> : <DiamondOutline />;
    case "metric_domain":
      return <BookOpenIcon />;
    case "business_term":
      return <MessageSquareQuoteIcon />;
  }
}

export function itemHint(item: PaletteItem): string {
  switch (item.kind) {
    case "action":
      return "新建";
    case "nav":
    case "settings":
      return "页面";
    case "board":
      return "看板";
    case "report":
      return "报告";
    case "analysis":
      return "查询记录";
    case "member":
      return item.memberKind === "measure" ? "指标" : "维度";
    case "metric_domain":
      return "指标域";
    case "business_term":
      return "业务术语";
  }
}
