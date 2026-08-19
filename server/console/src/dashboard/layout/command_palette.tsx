/**
 * 全局命令面板：侧栏搜索与 ⌘K 共用这一个面。
 * 空态仅输入行 + 脚注；有查询字展开扁平结果（类型在右侧，无分组标题）。
 * 选中即整页导航；字典项跳指标字典并预填搜索词（sessionStorage）。
 * 数据首开时拉取并缓存本次会话；任一数据源失败只缺该源不整体失败。
 */
import { useEffect, useMemo, useState } from "react";
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
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  type CommandFinalFocus,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandKbd,
  CommandList,
  CommandPanel,
} from "@/components/ui/command";
import {
  useBoards,
  useBusinessTerms,
  useCatalogQuery,
  useMyAnalyses,
  useReportsList,
} from "../dashboard_queries";
import { DiamondFilled, DiamondOutline } from "../analyses/member_picker";
import { analysisHash, analysisNewHash, boardHash, reportHash, type RouteKey } from "../router";
import type { NavEntry } from "./navigation";

export type PaletteItem =
  /** 动作项：目标不是一个已存在的资产，故不进「最近打开」。 */
  | { kind: "action"; label: string; hash: string }
  | { kind: "nav"; key: RouteKey; label: string }
  | { kind: "board"; id: string; name: string }
  | { kind: "report"; id: string; name: string }
  | { kind: "analysis"; id: string; title: string }
  | { kind: "member"; name: string; title: string; memberKind: "measure" | "dimension" }
  | { kind: "metric_domain"; id: string; title: string; synonyms: string[] }
  | { kind: "business_term"; id: string; canonicalTerm: string; definition: string };

type PaletteGroup = { value: string; items: PaletteItem[] };

const RECENTS_KEY = "pa.palette.recents";
const RECENTS_MAX = 6;
/** 指标字典页读后即清，见 catalog_page 的 keyword 初始化。 */
export const CATALOG_PREFILL_KEY = "pa.catalog.q";

function itemText(item: PaletteItem): string {
  switch (item.kind) {
    case "action":
      return item.label;
    case "nav":
      return item.label;
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
      return `${item.canonicalTerm} ${item.definition}`;
  }
}

/** 搜索可吃语义 id，同屏标签只显示业务名称；内部身份永不成为界面文案。 */
function itemLabel(item: PaletteItem): string {
  if (item.kind === "member" || item.kind === "metric_domain") return item.title;
  if (item.kind === "business_term") return item.canonicalTerm;
  return itemText(item);
}

function itemKey(item: PaletteItem): string {
  switch (item.kind) {
    case "action":
      return `action:${item.hash}`;
    case "nav":
      return `nav:${item.key}`;
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

function itemIcon(item: PaletteItem): React.ReactElement {
  switch (item.kind) {
    case "action":
      return <PlusIcon />;
    case "nav":
      return item.key === "settings" ? <SettingsIcon /> : <ArrowRightIcon />;
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

function itemHint(item: PaletteItem): string {
  switch (item.kind) {
    case "action":
      return "新建";
    case "nav":
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

function readRecents(): PaletteItem[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as PaletteItem[]) : [];
  } catch {
    return [];
  }
}

function pushRecent(item: PaletteItem): void {
  const next = [item, ...readRecents().filter((r) => itemKey(r) !== itemKey(item))].slice(
    0,
    RECENTS_MAX,
  );
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
}

export function CommandPalette({
  open,
  onOpenChange,
  finalFocus,
  navItems,
  navigate,
  onOpenSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 关掉后焦点还给谁：这一面没有触发件，由开它的那一处交代（见 shell）。 */
  finalFocus?: CommandFinalFocus;
  /** 已按角色过滤的主导航（设置项由本组件补充）。 */
  navItems: readonly NavEntry[];
  navigate: (r: RouteKey) => void;
  /** 设置走弹层，不占 `#/settings` 整页。 */
  onOpenSettings?: () => void;
}) {
  const [q, setQ] = useState("");
  // 首开拉取并缓存本次会话；任一数据源失败只缺该分组（isError → 空组），面板保持可用不整体失败。
  const boardsQuery = useBoards(open);
  const reportsQuery = useReportsList(open);
  const analysesQuery = useMyAnalyses(90, 30, 0, open);
  const catalogQuery = useCatalogQuery(open);
  const termsQuery = useBusinessTerms(open);

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  const boards = useMemo<PaletteItem[] | null>(
    () =>
      boardsQuery.isError
        ? []
        : (boardsQuery.data?.rows.map((r) => ({ kind: "board", id: r.id, name: r.name })) ?? null),
    [boardsQuery.data, boardsQuery.isError],
  );
  const reports = useMemo<PaletteItem[] | null>(
    () =>
      reportsQuery.isError
        ? []
        : (reportsQuery.data?.rows.map((r) => ({ kind: "report", id: r.id, name: r.name })) ??
          null),
    [reportsQuery.data, reportsQuery.isError],
  );
  const analyses = useMemo<PaletteItem[] | null>(
    () =>
      analysesQuery.isError
        ? []
        : (analysesQuery.data?.rows.flatMap((r) =>
            r.view_id ? [{ kind: "analysis", id: r.view_id, title: r.title }] : [],
          ) ?? null),
    [analysesQuery.data, analysesQuery.isError],
  );
  const catalog = useMemo<PaletteItem[] | null>(() => {
    if (catalogQuery.isError) return [];
    const d = catalogQuery.data;
    if (!d) return null;
    return [
      ...d.metric_domains.map(
        (topic): PaletteItem => ({
          kind: "metric_domain",
          id: topic.id,
          title: topic.title,
          synonyms: topic.synonyms,
        }),
      ),
      ...[...d.measures, ...d.dimensions].map(
        (m): PaletteItem => ({ kind: "member", name: m.id, title: m.title, memberKind: m.kind }),
      ),
    ];
  }, [catalogQuery.data, catalogQuery.isError]);
  const terms = useMemo<PaletteItem[] | null>(
    () =>
      termsQuery.isError
        ? []
        : (termsQuery.data?.rows.map(
            (term): PaletteItem => ({
              kind: "business_term",
              id: term.id,
              canonicalTerm: term.canonical_term,
              definition: term.definition,
            }),
          ) ?? null),
    [termsQuery.data, termsQuery.isError],
  );

  // 空白新建也是键盘可达的一等入口：Agent 优先不代表人只能从既有资产出发。
  const actionGroup: PaletteItem[] = [
    { kind: "action", label: "新建分析", hash: analysisNewHash() },
  ];
  const navGroup: PaletteItem[] = [
    ...navItems.map((n): PaletteItem => ({ kind: "nav", key: n.key, label: n.label })),
    { kind: "nav", key: "settings", label: "设置" },
  ];

  const idle = q.trim() === "";
  // 有查询时是扁平结果行（类型在右侧），不分组；空态不展开结果区。
  const groups: PaletteGroup[] = [
    {
      value: "结果",
      items: [
        ...actionGroup,
        ...navGroup,
        ...(boards ?? []),
        ...(reports ?? []),
        ...(analyses ?? []),
        ...(catalog ?? []),
        ...(terms ?? []),
      ],
    },
  ];

  function pick(item: PaletteItem) {
    onOpenChange(false);
    // 动作没有「打开过」的语义，不进最近列表。
    if (item.kind === "action") {
      window.location.hash = item.hash;
      return;
    }
    pushRecent(item);
    switch (item.kind) {
      case "nav":
        if (item.key === "settings" && onOpenSettings) {
          onOpenSettings();
          break;
        }
        navigate(item.key);
        break;
      case "board":
        window.location.hash = boardHash(item.id);
        break;
      case "report":
        window.location.hash = reportHash(item.id);
        break;
      case "analysis":
        window.location.hash = analysisHash(item.id);
        break;
      case "member":
      case "metric_domain":
        sessionStorage.setItem(CATALOG_PREFILL_KEY, item.title);
        navigate("catalog");
        break;
      case "business_term":
        sessionStorage.setItem(CATALOG_PREFILL_KEY, item.canonicalTerm);
        navigate("catalog");
        break;
    }
  }

  const loading = !idle && (boards === null || catalog === null || terms === null);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup finalFocus={finalFocus}>
        <Command
          items={groups}
          value={q}
          onValueChange={setQ}
          itemToStringValue={(it: unknown) => itemText(it as PaletteItem)}
        >
          <CommandInput placeholder="跳转至" />
          {/* 空态只有输入行 + 脚注；有查询字才展开结果区 */}
          {!idle ? (
            <CommandPanel>
              <CommandEmpty>{loading ? "载入中…" : "没有匹配的结果"}</CommandEmpty>
              <CommandList>
                {(group: PaletteGroup) => (
                  <CommandGroup key={group.value} items={group.items}>
                    <CommandCollection>
                      {(item: PaletteItem) => (
                        <CommandItem key={itemKey(item)} value={item} onClick={() => pick(item)}>
                          <span className="flex w-5 shrink-0 justify-center text-pa-muted [&_svg]:size-4">
                            {itemIcon(item)}
                          </span>
                          <span className="min-w-0 flex-1 truncate pb-0.5 leading-none">
                            {itemLabel(item)}
                          </span>
                          <span className="shrink-0 pb-0.5 text-sm text-pa-faint">
                            {itemHint(item)}
                          </span>
                        </CommandItem>
                      )}
                    </CommandCollection>
                  </CommandGroup>
                )}
              </CommandList>
            </CommandPanel>
          ) : null}
          <CommandFooter>
            <span className="min-w-0 flex-1 truncate">搜索指标、报告、看板、页面与设置</span>
            <CommandKbd>esc</CommandKbd>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
