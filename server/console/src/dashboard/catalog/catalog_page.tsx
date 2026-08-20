import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlertIcon, InboxIcon, LockIcon, PanelRightIcon, PlusIcon } from "lucide-react";
import type {
  PublicCatalogMember as CatalogMemberPayload,
  PublicCatalogDocument as CatalogPayload,
  PublicMetricDomain as MetricDomainPayload,
} from "@contracts/catalog_contract";
import type { PublicBusinessTerm } from "@contracts/business_term_contract";
import { BUSINESS_TERM_LIMITS } from "@contracts/business_term_contract";
import { isSearchableCatalogDimension } from "@contracts/catalog_contract";
import { LoadingMark } from "pa-result-view";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  INSPECTOR_SECTION_CLASS,
  InspectorOptionRow,
  InspectorSection,
} from "@/components/ui/inspector";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { POPOVER_LIST_WIDTH, PopoverListPanel } from "@/components/ui/popover-list";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toastManager } from "@/components/ui/toast";
import { Textarea } from "@/components/ui/textarea";
import {
  errorText,
  useAdminBusinessTerms,
  useBusinessTerms,
  useCatalogQuery,
  useCreateBusinessTerm,
  useDeleteBusinessTerm,
  useMe,
  useUpdateBusinessTerm,
} from "../dashboard_queries";
import { CatalogValuesDialog, type ValuesTarget } from "./catalog_values_dialog";
import { CATALOG_PREFILL_KEY } from "../layout/command_palette";
import {
  ListCategoryPill,
  ListControlBar,
  ListControlCategory,
  ListControlSearch,
  ListPageBody,
  ListScrollBody,
  useSetListChromeActions,
  useSetStageAside,
} from "../layout/layout_chrome";
import { Titlebar } from "@/components/ui/titlebar";
import { HeaderIconButton, HeaderTextAction } from "../layout/view_chrome";
import { EmptyPanel } from "../kit/empty_panel";
import { RowMenu } from "../kit/table_kit";
import { MenuDangerGroup, MenuItem } from "@/components/ui/menu";

/** 控制条分类：选项是 PA 的成员族。 */
type CatalogFacet = "measures" | "domains" | "dimensions" | "terms";

const CATALOG_FACETS: ReadonlyArray<{ value: CatalogFacet; label: string }> = [
  { value: "measures", label: "指标" },
  { value: "domains", label: "指标域" },
  { value: "dimensions", label: "维度" },
  { value: "terms", label: "业务术语" },
];

/** 点开的详情实体：成员（指标/维度）或指标域，共用一个侧滑面板。 */
type Detail =
  | { kind: "member"; member: CatalogMemberPayload }
  | { kind: "metric_domain"; topic: MetricDomainPayload };

type TermRow = PublicBusinessTerm;

function sensitivityLabel(sensitivity: string): string {
  return sensitivity === "restricted" ? "受限" : sensitivity;
}

export function CatalogPage() {
  const catalogQuery = useCatalogQuery();
  const isAdmin = useMe().data?.is_admin ?? false;
  const termsQuery = useBusinessTerms();
  const adminTermsQuery = useAdminBusinessTerms(isAdmin);
  const data = catalogQuery.data ?? null;
  const loading = catalogQuery.isLoading;
  const error =
    errorText(catalogQuery.error) ??
    errorText(termsQuery.error) ??
    errorText(adminTermsQuery.error);
  // 命令面板跳入时预填搜索词（单次传递，读后即清）
  const [keyword, setKeyword] = useState(() => {
    const prefill = sessionStorage.getItem(CATALOG_PREFILL_KEY) ?? "";
    sessionStorage.removeItem(CATALOG_PREFILL_KEY);
    return prefill;
  });
  const [facet, setFacet] = useState<CatalogFacet>("measures");
  const [valuesTarget, setValuesTarget] = useState<ValuesTarget | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editing, setEditing] = useState<PublicBusinessTerm | "new" | null>(null);
  const [deleting, setDeleting] = useState<PublicBusinessTerm | null>(null);

  const terms: TermRow[] = isAdmin
    ? (adminTermsQuery.data?.rows ?? [])
    : (termsQuery.data?.rows ?? []);
  const found = useMemo(() => filterCatalog(data, terms, keyword), [data, terms, keyword]);
  // 管理员恒见词典区（空词典也要有登记入口），故其空态不计入「什么都没搜到」。
  const nothing =
    (facet === "measures" && !found.measures.length) ||
    (facet === "dimensions" && !found.dimensions.length) ||
    (facet === "terms" && !found.terms.length && !isAdmin) ||
    (facet === "domains" && !(data?.metric_domains.length ?? 0));

  // 主操作在 titlebar：管理员登记词条与「+ 新建」同槽。
  useSetListChromeActions(
    () =>
      isAdmin ? (
        <HeaderTextAction onClick={() => setEditing("new")}>
          <PlusIcon aria-hidden="true" />
          新建术语
        </HeaderTextAction>
      ) : null,
    [isAdmin],
  );

  // 右栏里点「查看取值」：先收栏再开弹窗，避免栏与 Dialog 抢焦点
  function openValues(target: ValuesTarget) {
    setDetail(null);
    setValuesTarget(target);
  }

  /*
    公式行的分子分母是同一份目录里的成员，点它就把右栏换成那一条。
    换栏不切分类：栏是就地翻页，若连带把主表也翻到另一族，人就找不回刚才那条了。
  */
  const openMember = useCallback(
    (id: string) => {
      const member = [...(data?.measures ?? []), ...(data?.dimensions ?? [])].find(
        (candidate) => candidate.id === id,
      );
      if (member) setDetail({ kind: "member", member });
    },
    [data],
  );

  // 右栏档案开时 Esc 关闭（与能力地图检查器同出口）
  useEffect(() => {
    if (!detail) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  // 与工作台配置栏同槽：推挤列表、通高顶到 MAIN 白卡顶，不是 Sheet 罩层
  useSetStageAside(
    () =>
      detail ? (
        <CatalogProfileAside
          catalog={data}
          terms={termsQuery.data?.rows ?? []}
          detail={detail}
          onClose={() => setDetail(null)}
          onOpenMember={openMember}
          onValues={openValues}
        />
      ) : null,
    [detail, termsQuery.data?.rows, data, openMember],
  );

  return (
    <>
      <ListPageBody>
        <ListControlBar
          left={
            <ListControlCategory
              aria-label="分类"
              options={CATALOG_FACETS}
              value={facet}
              onValueChange={setFacet}
            />
          }
          right={
            <ListControlSearch
              aria-label="搜索指标、维度或业务术语"
              placeholder="搜索"
              value={keyword}
              onValueChange={setKeyword}
            />
          }
        />
        <ListScrollBody>
          <div className="mt-5">
            {error && (
              <Alert variant="error">
                <CircleAlertIcon />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}
            {loading && <LoadingMark className="py-16" />}
            {data && (
              <>
                {facet === "measures" && found.measures.length > 0 && (
                  <MeasureTable
                    catalog={data}
                    measures={found.measures}
                    onOpen={(member) => setDetail({ kind: "member", member })}
                  />
                )}
                {facet === "domains" && (
                  <MetricDomainSection
                    topics={data.metric_domains}
                    onOpen={(topic) => setDetail({ kind: "metric_domain", topic })}
                  />
                )}
                {facet === "dimensions" && found.dimensions.length > 0 && (
                  <DimensionTable
                    dimensions={found.dimensions}
                    onOpen={(member) => setDetail({ kind: "member", member })}
                  />
                )}
                {facet === "terms" && (found.terms.length > 0 || isAdmin) && (
                  <TermSection
                    terms={found.terms}
                    filtered={Boolean(keyword.trim())}
                    onEdit={isAdmin ? setEditing : undefined}
                    onDelete={isAdmin ? setDeleting : undefined}
                  />
                )}
                {nothing && !isAdmin && (
                  <EmptyPanel
                    text={
                      keyword
                        ? `没有匹配「${keyword}」的指标、维度或业务术语`
                        : "你的账号在目录中暂无可见成员"
                    }
                  />
                )}
              </>
            )}
          </div>
        </ListScrollBody>
      </ListPageBody>
      <CatalogValuesDialog target={valuesTarget} onClose={() => setValuesTarget(null)} />
      <BusinessTermEditorDialog
        members={[...(data?.measures ?? []), ...(data?.dimensions ?? [])]}
        onClose={() => setEditing(null)}
        target={editing}
      />
      <BusinessTermDeleteDialog onClose={() => setDeleting(null)} target={deleting} />
    </>
  );
}

function contains(term: string, texts: (string | undefined)[]): boolean {
  return texts.some((text) => (text ?? "").toLowerCase().includes(term));
}

/**
 * 按成员自身文本过滤（标题、口径、Agent 查询指引：搜"回流"能命中埋在指引里的成员）。
 * 成员与场景的可查关系是服务端选路职责，不在客户端展开——目录页只做语义身份与教学的浏览。
 */
function filterCatalog(data: CatalogPayload | null, terms: TermRow[], keyword: string) {
  const measures = data?.measures ?? [];
  const dimensions = data?.dimensions ?? [];
  const term = keyword.trim().toLowerCase();
  if (!term) return { measures, dimensions, terms };

  const hit = (member: CatalogMemberPayload) =>
    contains(term, [member.title, member.description, member.ai_context]);
  return {
    measures: measures.filter(hit),
    dimensions: dimensions.filter(hit),
    terms: terms.filter((row) =>
      contains(term, [
        row.canonical_term,
        row.definition,
        row.context,
        ...row.aliases,
        ...row.related_members.flatMap((member) => [member.title ?? undefined, member.id]),
      ]),
    ),
  };
}

/** 指标域：单表裸铺，无分区头。 */
function MetricDomainSection({
  topics,
  onOpen,
}: {
  topics: MetricDomainPayload[];
  onOpen: (topic: MetricDomainPayload) => void;
}) {
  if (!topics.length) {
    return <EmptyPanel text="暂无指标域" />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[60%]">指标域</TableHead>
          <TableHead className="w-[15%]">数据时间</TableHead>
          <TableHead className="w-[25%]">也叫</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {topics.map((topic) => (
          <TableRow className="cursor-pointer" key={topic.id} onClick={() => onOpen(topic)}>
            <TableCell>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{topic.title}</span>
              </div>
            </TableCell>
            <TableCell className="px-1.5 py-3">
              {topic.time_context_title ? (
                <ListCategoryPill
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  {topic.time_context_title}
                </ListCategoryPill>
              ) : (
                <span className="text-pa-muted">—</span>
              )}
            </TableCell>
            <TableCell className="whitespace-normal text-sm text-pa-muted">
              {topic.synonyms.length ? topic.synonyms.join("、") : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function formatLabel(format: string | undefined): string | null {
  if (!format) return null;
  if (format === "percent") return "百分比";
  if (format === "number") return "数值";
  return format;
}

/**
 * 清单主列：名称一行、说明一行，说明走次级字色。
 * 格自己撤掉 `whitespace-nowrap`——说明句不许换行时 `line-clamp-2` 收不住，
 * 整列被撑成一行的宽度，末列挤出白卡外。
 */
function MetricNameCell({ member }: { member: CatalogMemberPayload }) {
  return (
    <TableCell className="whitespace-normal">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1 text-sm font-medium">
          <span className="truncate">{member.title}</span>
          {member.sensitivity === "restricted" && (
            <LockIcon aria-label="受限" className="size-3.5 shrink-0 text-pa-muted" role="img">
              <title>受限：按数据权限可见</title>
            </LockIcon>
          )}
        </div>
        <p className="line-clamp-2 text-sm text-pa-muted">{member.description || "暂无指标说明"}</p>
      </div>
    </TableCell>
  );
}

/**
 * 第二列印归属，不印格式。格式只有率指标才有，整列十之八九是「—」——
 * 一列到底全是破折号，占的是宽度，给的不是信息。归属则每条都有，
 * 且正是扫这张表时唯一会拿来分组的东西。
 */
function MetricDomainCell({ domain }: { domain: MetricDomainPayload | undefined }) {
  return (
    <TableCell className="px-1.5 py-3">
      {domain ? (
        <ListCategoryPill
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          {domain.title}
        </ListCategoryPill>
      ) : (
        <span className="text-pa-muted">—</span>
      )}
    </TableCell>
  );
}

function MeasureTable({
  catalog,
  measures,
  onOpen,
}: {
  catalog: CatalogPayload | null;
  measures: CatalogMemberPayload[];
  onOpen: (member: CatalogMemberPayload) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[70%]">指标名</TableHead>
          <TableHead className="w-[30%]">指标域</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {measures.map((measure) => (
          <TableRow className="cursor-pointer" key={measure.id} onClick={() => onOpen(measure)}>
            <MetricNameCell member={measure} />
            <MetricDomainCell domain={domainOf(catalog, measure)} />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** 可翻值维度的「查看取值」入口在详情面板内，行面只留身份与说明。 */
function DimensionTable({
  dimensions,
  onOpen,
}: {
  dimensions: CatalogMemberPayload[];
  onOpen: (member: CatalogMemberPayload) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[60%]">维度</TableHead>
          <TableHead className="w-[40%]">说明</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {dimensions.map((dimension) => (
          <TableRow className="cursor-pointer" key={dimension.id} onClick={() => onOpen(dimension)}>
            <TableCell>
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-1 text-sm font-medium">
                  <span className="truncate">{dimension.title}</span>
                  {dimension.sensitivity === "restricted" && (
                    <LockIcon
                      aria-label="受限"
                      className="size-3.5 shrink-0 text-pa-muted"
                      role="img"
                    >
                      <title>受限：按数据权限可见</title>
                    </LockIcon>
                  )}
                </div>
              </div>
            </TableCell>
            <TableCell className="whitespace-normal text-sm text-pa-muted">
              {dimension.description || "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** 定义优先的业务术语：定义保存即生效，关联成员不是必填项。 */
function TermSection({
  terms,
  filtered,
  onEdit,
  onDelete,
}: {
  terms: TermRow[];
  filtered: boolean;
  onEdit?: (row: PublicBusinessTerm) => void;
  onDelete?: (row: PublicBusinessTerm) => void;
}) {
  if (terms.length === 0) {
    return (
      // 搜索无果不上图标：那是一次按键就能撤销的过渡回应，不是「这里还没有东西」的落地态
      filtered ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>没有匹配的业务术语</EmptyTitle>
            <EmptyDescription>清空搜索框可查看全部。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon />
            </EmptyMedia>
            <EmptyTitle>暂无业务术语</EmptyTitle>
            <EmptyDescription>可从一句准确、可独立理解的定义开始。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[24%]">规范术语</TableHead>
          <TableHead className="w-[46%]">定义</TableHead>
          <TableHead className="w-[25%]">关联</TableHead>
          {onEdit && <TableHead className="w-[5%]" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {terms.map((term) => (
          <TableRow key={term.id}>
            <TableCell>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium">{term.canonical_term}</span>
                <div className="flex flex-wrap items-center gap-1">
                  {term.aliases.length ? (
                    <span className="truncate text-xs text-pa-muted">
                      也叫：{term.aliases.join("、")}
                    </span>
                  ) : null}
                </div>
              </div>
            </TableCell>
            <TableCell className="whitespace-normal text-sm leading-5 text-pa-fg">
              {term.definition}
              {term.context ? (
                <p className="mt-1 text-xs text-pa-muted">语境：{term.context}</p>
              ) : null}
            </TableCell>
            <TableCell className="px-1.5 py-3">
              <div className="flex flex-wrap gap-1">
                {term.related_members.length ? (
                  term.related_members.map((member) =>
                    member.status === "available" ? (
                      <ListCategoryPill key={member.id} type="button">
                        {member.title}
                      </ListCategoryPill>
                    ) : (
                      <Badge key={member.id} variant="warning">
                        绑定已下线
                      </Badge>
                    ),
                  )
                ) : (
                  <span className="text-pa-muted">无需绑定</span>
                )}
              </div>
            </TableCell>
            {onEdit && (
              <TableCell className="px-1.5">
                <RowMenu label={`术语操作：${term.canonical_term}`}>
                  <MenuItem onClick={() => onEdit(term)}>编辑</MenuItem>
                  {onDelete ? (
                    <MenuDangerGroup>
                      <MenuItem onClick={() => onDelete(term)}>删除</MenuItem>
                    </MenuDangerGroup>
                  ) : null}
                </RowMenu>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BusinessTermEditorDialog({
  target,
  members,
  onClose,
}: {
  target: PublicBusinessTerm | "new" | null;
  members: CatalogMemberPayload[];
  onClose: () => void;
}) {
  const editing = target && target !== "new" ? target : null;
  const create = useCreateBusinessTerm();
  const update = useUpdateBusinessTerm();
  const [canonicalTerm, setCanonicalTerm] = useState("");
  const [definition, setDefinition] = useState("");
  const [context, setContext] = useState("");
  const [aliasesText, setAliasesText] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [relatedMemberIds, setRelatedMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setCanonicalTerm(editing?.canonical_term ?? "");
    setDefinition(editing?.definition ?? "");
    setContext(editing?.context ?? "");
    setAliasesText(editing?.aliases.join("、") ?? "");
    setMemberQuery("");
    setRelatedMemberIds(editing?.related_members.map((member) => member.id) ?? []);
    setError(null);
  }, [target, editing]);

  const aliases = aliasesText
    .split(/[，,、\n]/)
    .map((alias) => alias.trim())
    .filter(Boolean);
  const ready = Boolean(canonicalTerm.trim() && definition.trim());
  const pending = create.isPending || update.isPending;
  const missingMembers = relatedMemberIds.filter(
    (id) => !members.some((member) => member.id === id),
  );
  const normalizedMemberQuery = memberQuery.trim().toLocaleLowerCase();
  const visibleMembers = normalizedMemberQuery
    ? members.filter((member) =>
        `${member.title} ${member.id}`.toLocaleLowerCase().includes(normalizedMemberQuery),
      )
    : members;

  async function submit() {
    if (!ready) return;
    setError(null);
    try {
      const content = {
        canonical_term: canonicalTerm.trim(),
        definition: definition.trim(),
        ...(context.trim() ? { context: context.trim() } : {}),
        aliases,
        related_member_ids: relatedMemberIds,
      };
      const row = editing
        ? await update.mutateAsync({
            id: editing.id,
            body: content,
          })
        : await create.mutateAsync(content);
      toastManager.add({
        type: "success",
        title: editing ? `已保存「${row.canonical_term}」` : `已创建「${row.canonical_term}」`,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? `编辑术语：「${editing.canonical_term}」` : "新建业务术语"}
          </DialogTitle>
        </DialogHeader>
        <DialogPanel className="grid gap-6">
          {error && (
            <Alert variant="error">
              <CircleAlertIcon />
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="business-term-name">规范术语</FieldLabel>
            <Input
              id="business-term-name"
              maxLength={BUSINESS_TERM_LIMITS.canonical_term}
              onChange={(event) => setCanonicalTerm(event.target.value)}
              placeholder="如 Band C+"
              value={canonicalTerm}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="business-term-definition">定义</FieldLabel>
            <Textarea
              id="business-term-definition"
              maxLength={BUSINESS_TERM_LIMITS.definition}
              onChange={(event) => setDefinition(event.target.value)}
              placeholder="用一句自含说明解释它在业务中的含义。"
              value={definition}
            />
            <FieldDescription>
              这是 Agent 理解术语的事实源；不需要对应某个字段或数据值。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="business-term-context">适用语境（可选）</FieldLabel>
            <Input
              id="business-term-context"
              maxLength={BUSINESS_TERM_LIMITS.context}
              onChange={(event) => setContext(event.target.value)}
              placeholder="说明容易混淆的边界或使用场景"
              value={context}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="business-term-aliases">其他叫法（可选）</FieldLabel>
            <Input
              id="business-term-aliases"
              onChange={(event) => setAliasesText(event.target.value)}
              placeholder="用逗号或顿号分隔"
              value={aliasesText}
            />
            <FieldDescription>
              最多 {BUSINESS_TERM_LIMITS.aliases} 个；规范叫法与其他叫法不能重复。
            </FieldDescription>
          </Field>
          <fieldset className="flex min-w-0 flex-col items-start gap-1">
            <legend className="font-medium text-base/4.5 text-pa-fg sm:text-sm/4">
              相关数据成员（可选）
            </legend>
            <p className="text-pa-muted text-xs">
              只帮助 Agent 从解释导航到目录，不会生成过滤条件或改写查询。
            </p>
            <Input
              aria-label="搜索相关数据成员"
              className="mt-1"
              onChange={(event) => setMemberQuery(event.target.value)}
              placeholder="搜索指标或维度"
              type="search"
              value={memberQuery}
            />
            <div className="mt-1 max-h-52 overflow-y-auto rounded-sm border border-pa-line p-1">
              {missingMembers.map((id) => (
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-pa-surface"
                  htmlFor={`business-term-member-${id}`}
                  key={id}
                >
                  <Checkbox
                    aria-label={`移除已下线关联：${id}`}
                    checked
                    id={`business-term-member-${id}`}
                    onCheckedChange={() =>
                      setRelatedMemberIds((current) => current.filter((item) => item !== id))
                    }
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{id}</span>
                  <Badge variant="warning">已下线</Badge>
                </label>
              ))}
              {visibleMembers.map((member) => {
                const checked = relatedMemberIds.includes(member.id);
                return (
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-pa-surface"
                    htmlFor={`business-term-member-${member.id}`}
                    key={member.id}
                  >
                    <Checkbox
                      aria-label={`关联数据成员：${member.title}`}
                      checked={checked}
                      id={`business-term-member-${member.id}`}
                      onCheckedChange={(next) =>
                        setRelatedMemberIds((current) =>
                          next ? [...current, member.id] : current.filter((id) => id !== member.id),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{member.title}</span>
                    <span className="text-xs text-pa-muted">
                      {member.kind === "measure" ? "指标" : "维度"}
                    </span>
                  </label>
                );
              })}
              {visibleMembers.length === 0 ? (
                <p className="px-2 py-4 text-center text-sm text-pa-muted">没有匹配的数据成员</p>
              ) : null}
            </div>
          </fieldset>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="subtle" />}>取消</DialogClose>
          <Button
            disabled={!ready}
            loading={pending}
            onClick={() => void submit()}
            variant="filled"
          >
            保存
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function BusinessTermDeleteDialog({
  target,
  onClose,
}: {
  target: PublicBusinessTerm | null;
  onClose: () => void;
}) {
  const remove = useDeleteBusinessTerm();

  async function confirm() {
    if (!target) return;
    try {
      await remove.mutateAsync(target.id);
      toastManager.add({ type: "success", title: `已删除「${target.canonical_term}」` });
      onClose();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "删除失败",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <AlertDialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>删除「{target?.canonical_term}」？</AlertDialogTitle>
          <AlertDialogDescription>
            删除后 Agent 将不再获得该术语的定义，此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="subtle" />}>取消</AlertDialogClose>
          <Button loading={remove.isPending} onClick={() => void confirm()} variant="danger">
            确认删除
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

/** 指标 → 归属指标域。从属只由域这一头声明一次，成员不反向携带域 id。 */
function domainOf(
  catalog: CatalogPayload | null,
  member: CatalogMemberPayload,
): MetricDomainPayload | undefined {
  if (member.kind !== "measure") return undefined;
  return catalog?.metric_domains.find((domain) => domain.measure_ids.includes(member.id));
}

/** 一个业务属性组，及其在本域可拆的维度业务名。 */
type DimensionGroupRow = { group: string; titles: string[] };

/**
 * 维度语义 id 清单 → 按业务属性组归拢的业务名。查不到名字的直接丢掉，
 * 宁可少一项也不退回 id 顶替。组序与组内序都随模型给的次序，前端不另排。
 */
function dimensionGroups(catalog: CatalogPayload | null, ids: string[]): DimensionGroupRow[] {
  const wanted = new Set(ids);
  const rows: DimensionGroupRow[] = [];
  const byGroup = new Map<string, DimensionGroupRow>();
  for (const member of catalog?.dimensions ?? []) {
    if (!wanted.has(member.id)) continue;
    const group = member.dimension_group?.title ?? "其他";
    let row = byGroup.get(group);
    if (!row) {
      row = { group, titles: [] };
      byGroup.set(group, row);
      rows.push(row);
    }
    row.titles.push(member.title);
  }
  return rows;
}

/**
 * 字典成员/指标域档案：壳层右栏，与报告 `ReportInspector` 同槽。
 * 内容是只读 About（题头 + 定义散文 + Options 式键值），不是查询配置。
 */
function CatalogProfileAside({
  catalog,
  detail,
  terms,
  onClose,
  onOpenMember,
  onValues,
}: {
  catalog: CatalogPayload | null;
  detail: Detail;
  terms: PublicBusinessTerm[];
  onClose: () => void;
  onOpenMember: (id: string) => void;
  onValues: (target: ValuesTarget) => void;
}) {
  const domain = detail.kind === "member" ? domainOf(catalog, detail.member) : detail.topic;
  const title = detail.kind === "member" ? detail.member.title : detail.topic.title;
  const dimensions = dimensionGroups(catalog, domain?.dimension_ids ?? []);

  return (
    <aside
      aria-label="字典档案"
      className="relative flex h-full min-h-0 w-full min-w-0 flex-col border-t border-pa-line bg-pa-bg sm:border-t-0 sm:border-l-[0.5px] sm:border-pa-line"
      data-slot="catalog-profile-aside"
    >
      <Titlebar align="end" className="gap-0">
        <HeaderIconButton label="关闭档案" onClick={onClose}>
          <PanelRightIcon aria-hidden="true" />
        </HeaderIconButton>
      </Titlebar>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="border-b-[0.5px] border-pa-line px-3 py-3 md:px-2.5">
          <h2 className="text-xl font-semibold text-pa-fg">{title}</h2>
        </div>
        {detail.kind === "member" ? (
          <MemberProfileBody
            dimensions={dimensions}
            domain={domain}
            member={detail.member}
            onOpenMember={onOpenMember}
            onValues={onValues}
            terms={terms}
          />
        ) : (
          <MetricDomainProfileBody dimensions={dimensions} topic={detail.topic} />
        )}
      </div>
    </aside>
  );
}

/**
 * 元信息网格：label 左、值右，**整块不带段题**。这些是同一类东西——关于这条成员的
 * 若干项事实，各自给一个带边框的段题，段题会比它统辖的那一个值还重。
 */
function ProfileFacts({ children }: { children: React.ReactNode }) {
  return (
    <div className={INSPECTOR_SECTION_CLASS} data-slot="catalog-profile-facts">
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function DimensionsRow({ groups }: { groups: DimensionGroupRow[] }) {
  const count = groups.reduce((total, row) => total + row.titles.length, 0);
  if (count === 0) return null;
  return (
    <InspectorOptionRow label="可用维度">
      <Popover>
        <PopoverTrigger render={<ListCategoryPill />}>{count} 个</PopoverTrigger>
        <PopoverPopup align="end" className={POPOVER_LIST_WIDTH}>
          <PopoverListPanel>
            <ul className="flex flex-col gap-1.5 px-1 py-0.5 text-sm leading-5">
              {groups.map((row) => (
                <li key={row.group}>
                  <span className="font-medium">{row.group}</span>：{row.titles.join("、")}
                </li>
              ))}
            </ul>
          </PopoverListPanel>
        </PopoverPopup>
      </Popover>
    </InspectorOptionRow>
  );
}

/**
 * 公式行：分子分母各成一枚芯片。它们本身就是这份目录里的成员，
 * 「这个数由哪两个数算出」与「那两个数又是什么」该一步可达，不该是一行读完就断的灰字。
 * 内部计算件没有公开身份，那一端便是静态芯片——点不动，但仍然读得懂。
 */
function FormulaRow({
  formula,
  onOpenMember,
}: {
  formula: NonNullable<CatalogMemberPayload["formula"]>;
  onOpenMember: (id: string) => void;
}) {
  const end = (title: string, id: string | undefined) =>
    id ? (
      <ListCategoryPill onClick={() => onOpenMember(id)}>{title}</ListCategoryPill>
    ) : (
      <ListCategoryPill absent>{title}</ListCategoryPill>
    );
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {end(formula.numerator, formula.numerator_id)}
      <span className="text-sm text-pa-muted">÷</span>
      {end(formula.denominator, formula.denominator_id)}
    </div>
  );
}

/** 成员完整档案：口径与公式、元信息网格、关联业务术语；指标另有开分析、维度另有翻值入口。 */
function MemberProfileBody({
  member,
  dimensions,
  domain,
  terms,
  onOpenMember,
  onValues,
}: {
  member: CatalogMemberPayload;
  /** 该指标可拆的维度，按业务属性组归拢；维度成员为空。 */
  dimensions: DimensionGroupRow[];
  /** 该指标归属的指标域；维度不属于任何域。 */
  domain?: MetricDomainPayload;
  terms: PublicBusinessTerm[];
  onOpenMember: (id: string) => void;
  onValues: (target: ValuesTarget) => void;
}) {
  const related = terms.filter((term) =>
    term.related_members.some((relatedMember) => relatedMember.id === member.id),
  );
  const format = formatLabel(member.format);
  const dimensionKind = member.dimension_kind === "overlapping" ? "可重叠" : null;
  // 翻值入口挂在口径旁：「它是什么」与「它都有哪些值」是同一个问题的两半。
  const action = isSearchableCatalogDimension(member) ? (
    <Button
      onClick={() => onValues({ member: member.id, title: member.title })}
      size="compact"
      variant="default"
    >
      查看取值
    </Button>
  ) : undefined;
  /*
    元信息全在一张网格里，缺项就少一行。一行不剩时整块不出，
    不留一个空着的框冒充内容。「类型」不入网格：人是从「指标」或「维度」
    那一栏点进来的，那一行只是把来路复述一遍。
  */
  const facts =
    (domain ? 1 : 0) +
    (dimensions.length ? 1 : 0) +
    [format, member.sensitivity, dimensionKind].filter(Boolean).length;
  return (
    <>
      <InspectorSection actions={action} title="定义">
        <p className="text-sm leading-5 text-pa-fg">{member.description || "—"}</p>
        {member.formula ? (
          <FormulaRow formula={member.formula} onOpenMember={onOpenMember} />
        ) : null}
      </InspectorSection>
      {facts > 0 ? (
        <ProfileFacts>
          {domain ? (
            <InspectorOptionRow label="指标域">
              <span className="text-sm text-pa-fg">{domain.title}</span>
            </InspectorOptionRow>
          ) : null}
          <DimensionsRow groups={dimensions} />
          {domain?.time_context_title ? (
            <InspectorOptionRow label="数据时间">
              <span className="text-sm text-pa-fg">{domain.time_context_title}</span>
            </InspectorOptionRow>
          ) : null}
          {format ? (
            <InspectorOptionRow label="格式">
              <span className="text-sm text-pa-fg">{format}</span>
            </InspectorOptionRow>
          ) : null}
          {member.sensitivity ? (
            <InspectorOptionRow label="敏感度">
              <span className="text-sm text-pa-fg">{sensitivityLabel(member.sensitivity)}</span>
            </InspectorOptionRow>
          ) : null}
          {dimensionKind ? (
            <InspectorOptionRow label="维度种类">
              <span className="text-sm text-pa-fg">{dimensionKind}</span>
            </InspectorOptionRow>
          ) : null}
        </ProfileFacts>
      ) : null}
      {related.length > 0 ? (
        <InspectorSection title="相关业务术语">
          <ul className="flex flex-col gap-1 text-sm leading-5">
            {related.map((term) => (
              <li key={term.id}>
                <span className="font-medium">{term.canonical_term}</span>：{term.definition}
              </li>
            ))}
          </ul>
        </InspectorSection>
      ) : null}
    </>
  );
}

/** 指标域完整档案：数据范围散文一节，其余元信息同走一张网格。 */
function MetricDomainProfileBody({
  topic,
  dimensions,
}: {
  topic: MetricDomainPayload;
  dimensions: DimensionGroupRow[];
}) {
  return (
    <>
      {topic.query_contract ? (
        <InspectorSection title="数据范围与口径">
          <p className="text-sm leading-5 text-pa-fg">{topic.query_contract}</p>
        </InspectorSection>
      ) : null}
      <ProfileFacts>
        <DimensionsRow groups={dimensions} />
        {topic.time_context_title ? (
          <InspectorOptionRow label="数据时间">
            <span className="text-sm text-pa-fg">{topic.time_context_title}</span>
          </InspectorOptionRow>
        ) : null}
        {topic.synonyms.length > 0 ? (
          <InspectorOptionRow label="也叫">
            <span className="text-sm text-pa-fg">{topic.synonyms.join("、")}</span>
          </InspectorOptionRow>
        ) : null}
      </ProfileFacts>
    </>
  );
}
