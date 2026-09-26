/** 全局命令面板，侧栏搜索和 ⌘K 共用。 */
import { useEffect, useMemo, useState } from "react";
import { LoadingMark } from "pa-result-view";
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
import { prefillCatalogSearch } from "../catalog/prefill";
import {
  analysisHash,
  analysisNewHash,
  boardHash,
  navigateTo,
  reportHash,
  type RouteKey,
} from "../router";
import { itemHint, itemIcon, itemKey, itemLabel, itemText, type PaletteItem } from "./palette_item";
import type { NavEntry } from "./navigation";

type PaletteGroup = { value: string; items: PaletteItem[] };

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
  /** 面板没有触发按钮，关闭后的焦点目标由打开它的调用方（shell）传入。 */
  finalFocus?: CommandFinalFocus;
  navItems: readonly NavEntry[];
  navigate: (r: RouteKey) => void;
  onOpenSettings: () => void;
}) {
  const [q, setQ] = useState("");
  // 打开时才取数；某个数据源失败时只让该分组为空，面板其余部分照常可用。
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
              aliases: term.aliases,
              definition: term.definition,
            }),
          ) ?? null),
    [termsQuery.data, termsQuery.isError],
  );

  const actionGroup: PaletteItem[] = [
    { kind: "action", label: "新建分析", hash: analysisNewHash() },
  ];
  const navGroup: PaletteItem[] = [
    ...navItems.map((n): PaletteItem => ({ kind: "nav", key: n.key, label: n.label })),
    { kind: "settings" },
  ];

  const idle = q.trim() === "";
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
    switch (item.kind) {
      case "action":
        navigateTo(item.hash);
        break;
      case "nav":
        navigate(item.key);
        break;
      case "settings":
        onOpenSettings();
        break;
      case "board":
        navigateTo(boardHash(item.id));
        break;
      case "report":
        navigateTo(reportHash(item.id));
        break;
      case "analysis":
        navigateTo(analysisHash(item.id));
        break;
      // 跳到对应清单页，并预填搜索词。
      case "member":
        prefillCatalogSearch(item.title);
        navigate(item.memberKind === "dimension" ? "dimensions" : "metrics");
        break;
      case "metric_domain":
        prefillCatalogSearch(item.title);
        navigate("metrics");
        break;
      case "business_term":
        prefillCatalogSearch(item.canonicalTerm);
        navigate("terms");
        break;
    }
  }

  const loading =
    !idle && [boards, reports, analyses, catalog, terms].some((source) => source === null);

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
          {!idle ? (
            <CommandPanel>
              <CommandEmpty>
                {loading ? <LoadingMark size="small" /> : "没有匹配的结果"}
              </CommandEmpty>
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
