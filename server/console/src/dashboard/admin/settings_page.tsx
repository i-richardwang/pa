import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  PlusIcon,
  Trash2Icon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import type { PresentedAccessScope } from "@contracts/access_scope";
import type { SettingsTab } from "../router";
import type { MePayload } from "@contracts/session_contract";
import { LoadingMark } from "pa-result-view";
import { useCopyToClipboard } from "@/hooks/use_copy_text";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Avatar } from "@/components/ui/avatar";
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
  OverlayCloseButton,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InspectorBody, InspectorRow } from "@/components/ui/inspector";
import { MenuItem } from "@/components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SIDEBAR_WIDTH,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { toastManager } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Titlebar } from "@/components/ui/titlebar";
import { errorText, formatAt } from "../api";
import { RowMenu } from "../kit/table_kit";
import { RowBadge } from "../kit/settings_kit";
import { TitlebarActionsOutlet, TitlebarActionsProvider } from "../layout/layout_chrome";
import { UsersPage } from "./users_page";
import { type ApiKeyRow, useApiKeys, useCreateApiKey, useRevokeApiKey } from "../dashboard_queries";

const FORM_COLUMN_CLASS = "md:mx-auto md:max-w-2xl";

export function SettingsDialog({
  me,
  open,
  onOpenChange,
  tab = "account",
}: {
  me: MePayload;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 每次打开都从该页开始，不记住上次停留的页。 */
  tab?: SettingsTab;
}) {
  const [current, setCurrent] = useState<SettingsTab>(tab);
  useEffect(() => {
    if (open) setCurrent(tab);
  }, [tab, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup showCloseButton={false} variant="stage">
        <DialogTitle className="sr-only">设置</DialogTitle>
        <TitlebarActionsProvider>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:h-full md:flex-row">
            <SettingsAside me={me} onSelect={setCurrent} tab={current} />
            <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1">
                <TitlebarActionsOutlet />
                <DialogClose aria-label="关闭" render={<OverlayCloseButton />}>
                  <XIcon aria-hidden="true" />
                </DialogClose>
              </div>
              {/* 设置页使用详情栏的行密度。 */}
              <InspectorBody className="overscroll-auto" face="profile">
                <div
                  className={cn(
                    "px-6 py-6 md:w-full md:px-8 md:py-12",
                    current === "users" ? "md:max-w-none" : FORM_COLUMN_CLASS,
                  )}
                >
                  {current === "account" ? (
                    <AccountPage me={me} />
                  ) : current === "users" ? (
                    <UsersPage me={me} />
                  ) : (
                    <KeysPage />
                  )}
                </div>
              </InspectorBody>
            </section>
          </div>
        </TitlebarActionsProvider>
      </DialogPopup>
    </Dialog>
  );
}

function SettingsAside({
  me,
  tab,
  onSelect,
}: {
  me: MePayload;
  tab: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
}) {
  const initial = (me.name.trim().charAt(0) || me.email.charAt(0) || "?").toUpperCase();
  const item = (key: SettingsTab, icon: ReactNode, label: string) => (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={tab === key} onClick={() => onSelect(key)}>
        <span className="mr-0.5 flex size-8 shrink-0 items-center justify-center">{icon}</span>
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
  return (
    <aside
      className="relative flex h-auto w-full shrink-0 flex-col border-b border-pa-line md:h-full md:w-(--sidebar-width) md:border-r-[0.5px] md:border-b-0"
      style={{ "--sidebar-width": SIDEBAR_WIDTH } as CSSProperties}
    >
      <Titlebar as="div">
        <div className="flex-1 truncate px-2 font-medium text-sm">设置</div>
      </Titlebar>
      <div className="flex flex-1 flex-col overflow-y-auto px-3.5 pb-3.5">
        <SidebarGroup>
          <SidebarGroupLabel>账户</SidebarGroupLabel>
          <SidebarMenu>
            {item("account", <UserIcon aria-hidden="true" />, "账号")}
            {item("api", <KeyRoundIcon aria-hidden="true" />, "API Key")}
          </SidebarMenu>
        </SidebarGroup>
        {me.is_admin ? (
          <SidebarGroup>
            <SidebarGroupLabel>工作区</SidebarGroupLabel>
            <SidebarMenu>{item("users", <UsersIcon aria-hidden="true" />, "成员")}</SidebarMenu>
          </SidebarGroup>
        ) : null}
      </div>
      <div className="flex items-center border-t border-pa-line px-4.5 pt-4 pb-5">
        <Avatar className="mr-2.5" size="sm" tone="accent">
          {initial}
        </Avatar>
        <div className="mr-1 min-w-0">
          <div className="min-w-0 truncate font-medium text-sm md:text-xs" title={me.name}>
            {me.name}
          </div>
          <div className="min-w-0 truncate text-pa-faint text-xs leading-none" title={me.email}>
            {me.email}
          </div>
        </div>
      </div>
    </aside>
  );
}

function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-pa-canvas p-3">{children}</div>;
}

function SettingsGroupTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-10 mb-4 flex items-center gap-2 font-semibold text-lg md:mb-3 md:text-md">
      {children}
    </h3>
  );
}

function capabilities(isAdmin: boolean): string[] {
  const base = [
    "在 AI 客户端连接 PA 数据服务发起查询（数据查询走 MCP，不在控制台内）",
    "创建并吊销接入用的 API Key（绑本人身份）",
    "查看本人的查询记录",
  ];
  return isAdmin
    ? [...base, "查看全部使用日志（所有调用者的问题原文与运行状态）", "管理用户与角色权限"]
    : base;
}

function roleLabel(role: string): string {
  const parts = role.split(",").map((r) => r.trim());
  const names = parts.map((r) => (r === "user" ? "分析用户" : r === "admin" ? "管理员" : r));
  return names.join(" · ");
}

function scopeLabel(accessScope: PresentedAccessScope): string {
  if (accessScope.kind === "all") return `全部${accessScope.title}`;
  if (!accessScope.values.length)
    return `未授权（暂无${accessScope.title}数据可查，请联系管理员开通）`;
  return accessScope.values.join("、");
}

function AccountPage({ me }: { me: MePayload }) {
  return (
    <>
      <div className="mb-10 flex flex-col gap-2.5 md:mt-5 md:px-1">
        <h2 className="font-semibold text-3xl md:text-xl">账号</h2>
        <p className="text-pa-muted text-sm/4.5">
          当前登录身份与控制台权限。数据查询走 MCP，不在控制台内发起。
        </p>
      </div>
      <SettingsCard>
        <InspectorRow label="姓名">{me.name}</InspectorRow>
        <InspectorRow label="邮箱">{me.email}</InspectorRow>
        <InspectorRow label="角色（可见字段）">
          <span className="inline-flex items-center gap-2 text-sm">
            {roleLabel(me.role)}
            <Badge>{me.is_admin ? "管理员" : "成员"}</Badge>
          </span>
        </InspectorRow>
        <InspectorRow label={`数据权限（可查${me.access_scope.title}）`}>
          {scopeLabel(me.access_scope)}
        </InspectorRow>
      </SettingsCard>
      <SettingsGroupTitle>当前权限</SettingsGroupTitle>
      <SettingsCard>
        <ul className="space-y-2 px-2 py-1 text-sm">
          {capabilities(me.is_admin).map((cap) => (
            <li key={cap} className="flex items-start gap-2">
              <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-pa-muted" />
              <span>{cap}</span>
            </li>
          ))}
        </ul>
      </SettingsCard>
    </>
  );
}

const DAY = 60 * 60 * 24;
const EXPIRY_OPTIONS: readonly { label: string; seconds: number | null }[] = [
  { label: "永不过期", seconds: null },
  { label: "30 天", seconds: 30 * DAY },
  { label: "90 天", seconds: 90 * DAY },
  { label: "1 年", seconds: 365 * DAY },
];

function KeysPage() {
  const keysQuery = useApiKeys();
  const revokeKey = useRevokeApiKey();
  const [showCreate, setShowCreate] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  // 沿用服务端顺序（按签发时间倒序）。
  const keys = keysQuery.data ?? null;
  const rows = keys ?? [];
  const error = errorText(keysQuery.error) ?? errorText(revokeKey.error);

  function revoke(k: ApiKeyRow) {
    revokeKey.mutate(k.id, {
      onSuccess: () => {
        toastManager.add({ type: "success", title: `已吊销「${k.name || "未命名"}」` });
      },
    });
  }

  return (
    <>
      <div className="mb-10 flex flex-col gap-2.5 md:mt-5 md:px-1">
        <h2 className="text-3xl font-semibold md:text-xl">API Key</h2>
        <p className="text-sm/4.5 text-pa-muted">
          在 AI 客户端或脚本以{" "}
          <code className="rounded-md bg-pa-surface px-[0.3rem] py-[0.2rem] font-mono text-xs text-pa-muted">
            Authorization: Bearer &lt;key&gt;
          </code>{" "}
          接入 /mcp。完整 key 只在创建时展示一次。
        </p>
      </div>

      <div className="mb-8 flex items-center gap-3 md:gap-2">
        <Button onClick={() => setShowCreate(true)} variant="filled">
          <PlusIcon aria-hidden="true" />
          新建 Key
        </Button>
      </div>

      {error && (
        <Alert className="mb-6" variant="error">
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      {!keys ? (
        <LoadingMark className="py-16" />
      ) : keys.length === 0 ? null : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead className="hidden md:table-cell">创建</TableHead>
              <TableHead className="hidden md:table-cell">最近使用</TableHead>
              <TableHead>到期</TableHead>
              <TableHead className="w-14" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((k) => {
              const expired = k.expiresAt != null && new Date(k.expiresAt).getTime() < Date.now();
              return (
                <TableRow key={k.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <RowBadge>
                        <KeyRoundIcon />
                      </RowBadge>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{k.name || "（未命名）"}</div>
                        <code className="block truncate font-mono text-pa-faint text-xs">
                          {k.start ?? "—"}…
                        </code>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-pa-muted text-sm md:table-cell">
                    {formatAt(k.createdAt)}
                  </TableCell>
                  <TableCell className="hidden text-pa-muted text-sm md:table-cell">
                    {formatAt(k.lastRequest)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {k.expiresAt == null ? (
                      <span className="text-pa-muted">永不</span>
                    ) : expired ? (
                      <Badge variant="warning">已过期</Badge>
                    ) : (
                      <span className="text-pa-muted">{formatAt(k.expiresAt)}</span>
                    )}
                  </TableCell>
                  <TableCell className="py-0 text-right">
                    <RowMenu label="Key 操作">
                      <MenuItem onClick={() => setRevokeTarget(k)}>
                        <Trash2Icon aria-hidden="true" />
                        吊销
                      </MenuItem>
                    </RowMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <CreateKeyDialog open={showCreate} onClose={() => setShowCreate(false)} />

      <AlertDialog open={revokeTarget != null} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>吊销「{revokeTarget?.name || "未命名"}」？</AlertDialogTitle>
            <AlertDialogDescription>
              使用这个 Key 的客户端和脚本会立即断开连接，且无法恢复，需要重新创建 Key。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="subtle" />}>取消</AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="danger"
                  onClick={() => {
                    if (revokeTarget) revoke(revokeTarget);
                  }}
                />
              }
            >
              吊销
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function CreateKeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [expiryIdx, setExpiryIdx] = useState(0);
  const [issued, setIssued] = useState<{ key: string; name: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const createKey = useCreateApiKey();
  const formError = errorText(createKey.error);

  function reset() {
    setName("");
    setExpiryIdx(0);
    createKey.reset();
    setIssued(null);
    setSaved(false);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const expiresIn = EXPIRY_OPTIONS[expiryIdx].seconds;
    const keyName = name.trim();
    createKey.mutate(
      { name: keyName, ...(expiresIn != null ? { expiresIn } : {}) },
      { onSuccess: (key) => setIssued({ key, name: keyName }) },
    );
  }

  // 明文显示且未确认已保存时，禁止弹层的所有自动关闭方式。
  const locked = issued != null && !saved;

  return (
    <Dialog
      disablePointerDismissal={locked}
      open={open}
      onOpenChange={(next, event) => {
        if (next) return;
        if (locked) {
          event.cancel();
          return;
        }
        reset();
        onClose();
      }}
    >
      <DialogPopup showCloseButton={issued == null}>
        {issued ? (
          <IssuedKeyStep
            issued={issued}
            saved={saved}
            onSavedChange={setSaved}
            onClose={() => {
              reset();
              onClose();
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>新建 Key</DialogTitle>
            </DialogHeader>
            <Form className="contents" onSubmit={onSubmit}>
              <DialogPanel className="grid gap-4">
                <Field>
                  <FieldLabel htmlFor="key-name">名称</FieldLabel>
                  <Input
                    id="key-name"
                    required
                    placeholder="如：桌面端"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Select
                  items={EXPIRY_OPTIONS.map((o, i) => ({ label: o.label, value: i }))}
                  value={expiryIdx}
                  onValueChange={(v) => setExpiryIdx(v as number)}
                >
                  <SelectTrigger label="有效期">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {EXPIRY_OPTIONS.map((o, i) => (
                      <SelectItem key={o.label} value={i}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                {formError && (
                  <Field>
                    <FieldError match>{formError}</FieldError>
                  </Field>
                )}
              </DialogPanel>
              <DialogFooter>
                <Button
                  variant="filled"
                  type="submit"
                  loading={createKey.isPending}
                  disabled={name.trim().length === 0}
                >
                  创建 Key
                </Button>
              </DialogFooter>
            </Form>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}

function IssuedKeyStep({
  issued,
  saved,
  onSavedChange,
  onClose,
}: {
  issued: { key: string; name: string };
  saved: boolean;
  onSavedChange: (next: boolean) => void;
  onClose: () => void;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  return (
    <>
      <DialogHeader>
        <DialogTitle>Key 已创建</DialogTitle>
      </DialogHeader>
      <DialogPanel className="grid gap-5">
        <Alert variant="warning">
          <AlertTitle>只显示这一次</AlertTitle>
          <AlertDescription>关闭窗口后将无法再次查看完整的 Key。</AlertDescription>
        </Alert>

        <div className="flex flex-col gap-4 rounded-xl border border-pa-line p-4">
          {issued.name && <div className="font-medium text-sm">{issued.name}</div>}
          <code className="min-w-0 select-text break-all font-mono text-pa-muted text-xs">
            {issued.key}
          </code>
          <Button
            className="self-start"
            onClick={() => copyToClipboard(issued.key)}
            variant="subtle"
          >
            {isCopied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            {isCopied ? "已复制" : "复制"}
          </Button>
        </div>
      </DialogPanel>
      <DialogFooter className="flex-col items-center gap-4 sm:justify-between sm:gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm" htmlFor="api-key-saved">
          <Checkbox
            checked={saved}
            id="api-key-saved"
            onCheckedChange={(next) => onSavedChange(next === true)}
          />
          我已经保存好这个 Key
        </label>
        <Button disabled={!saved} onClick={onClose} variant="filled">
          关闭
        </Button>
      </DialogFooter>
    </>
  );
}
