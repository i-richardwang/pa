import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  KeyRoundIcon,
  PlusIcon,
  Trash2Icon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import type { PresentedAccessScope } from "@contracts/access_scope";
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
  settingsDialogClass,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MenuItem } from "@/components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { authClient } from "../../auth_client";
import { Titlebar } from "@/components/ui/titlebar";
import { RowMenu } from "../kit/table_kit";
import { RowBadge, SettingsChromeContext } from "../kit/settings_kit";
import { UsersPage } from "./users_page";
import { authErrorText } from "../better_auth_adapter";

export type SettingsTab = "account" | "api" | "users";

export function SettingsDialog({
  me,
  open,
  onOpenChange,
  tab: initialTab = "account",
}: {
  me: MePayload;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 每次开启都回到这一节：弹层不留上次停在哪的记忆。 */
  tab?: SettingsTab;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [actions, setActions] = useState<ReactNode | null>(null);
  const chrome = useMemo(() => ({ setActions }), []);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [initialTab, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        bottomStickOnMobile={false}
        className={cn(settingsDialogClass, "overflow-hidden")}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">设置</DialogTitle>
        <SettingsChromeContext.Provider value={chrome}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:h-full md:flex-row">
            <SettingsAside me={me} onSelect={setTab} tab={tab} />
            <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1">
                {actions}
                <DialogClose aria-label="关闭" render={<OverlayCloseButton />}>
                  <XIcon aria-hidden="true" />
                </DialogClose>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-auto">
                <div
                  className={cn(
                    "px-6 py-6 md:w-full md:px-8 md:py-12",
                    tab === "users" ? "md:max-w-none" : "md:mx-auto md:max-w-[704px]",
                  )}
                >
                  {tab === "account" ? (
                    <AccountPage me={me} />
                  ) : tab === "users" ? (
                    <UsersPage me={me} />
                  ) : (
                    <KeysPage />
                  )}
                </div>
              </div>
            </section>
          </div>
        </SettingsChromeContext.Provider>
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
  return (
    <aside className="relative left-0 flex h-auto w-full shrink-0 flex-col border-b border-pa-line md:h-full md:w-[200px] md:border-r-[0.5px] md:border-b-0">
      <Titlebar as="div" className="h-16 px-3.5 md:h-(--pa-titlebar) md:pr-3 md:pl-2.5">
        <div className="flex-1 truncate px-2 pb-0.5 text-lg font-medium md:text-sm">设置</div>
      </Titlebar>
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-3.5">
        <div className="mb-2">
          <div className="group relative flex items-center py-2 pr-1.5 pl-1 text-sm font-medium tracking-[0.0125em] text-pa-faint">
            账户
          </div>
          <NavItem
            active={tab === "account"}
            icon={<UserIcon aria-hidden="true" className="size-4" />}
            label="账号"
            onClick={() => onSelect("account")}
          />
          <NavItem
            active={tab === "api"}
            icon={<KeyRoundIcon aria-hidden="true" className="size-4" />}
            label="API Key"
            onClick={() => onSelect("api")}
          />
        </div>
        {me.is_admin && (
          <div className="mb-2">
            <div className="group relative flex items-center py-2 pr-1.5 pl-1 text-sm font-medium tracking-[0.0125em] text-pa-faint">
              工作区
            </div>
            <NavItem
              active={tab === "users"}
              icon={<UsersIcon aria-hidden="true" className="size-4" />}
              label="成员"
              onClick={() => onSelect("users")}
            />
          </div>
        )}
      </div>
      <div className="border-t border-pa-line px-[18px] pt-4 pb-5">
        <div className="flex items-center">
          <Avatar className="mr-2.5" size="sm" tone="accent">
            {initial}
          </Avatar>
          <div className="mr-1 min-w-0">
            <div className="min-w-0 truncate text-sm font-medium md:text-xs" title={me.name}>
              {me.name}
            </div>
            <div className="min-w-0 truncate text-xs leading-none text-pa-faint" title={me.email}>
              {me.email}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function NavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "group flex h-8 w-full cursor-pointer items-center rounded-md pr-2 pl-0.5 text-left",
        active ? "bg-pa-surface text-pa-fg" : "text-pa-fg-soft hover:text-pa-fg",
      )}
      onClick={onClick}
      type="button"
    >
      <span className="mr-0.5 flex w-8 shrink-0 items-center justify-center">{icon}</span>
      <span className="truncate pb-px text-sm font-normal">{label}</span>
    </button>
  );
}

/** 字段行：左标签与说明，右控件。 */
function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-pa-line pb-5 not-last:mb-3 last:border-b-0 last:pb-0 md:flex-row md:items-center md:gap-8">
      <div className="grow">
        <h3 className="mb-1 text-lg/6 font-medium md:mb-0 md:text-md/6">{label}</h3>
        {description ? (
          <p className="text-base/5 text-pa-muted md:text-sm/4.5">{description}</p>
        ) : null}
      </div>
      {children != null ? (
        <div className="flex shrink-0 grow md:items-center md:justify-end">
          <div className="min-w-0 text-sm font-normal text-pa-fg md:text-right">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-pa-wash-solid px-5 pt-4.5 pb-5">{children}</div>;
}

function SettingsGroupTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-10 mb-4 flex items-center gap-2 text-lg font-semibold md:mb-3 md:text-md">
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
        <h2 className="text-3xl font-semibold md:text-xl">账号</h2>
        <p className="text-sm/4.5 text-pa-muted">
          当前登录身份与控制台权限。数据查询走 MCP，不在控制台内发起。
        </p>
      </div>
      <SettingsCard>
        <SettingsRow label="姓名">{me.name}</SettingsRow>
        <SettingsRow label="邮箱">{me.email}</SettingsRow>
        <SettingsRow description="决定可见字段集合。" label="角色（可见字段）">
          <span className="inline-flex items-center gap-2">
            {roleLabel(me.role)}
            <Badge>{me.is_admin ? "管理员" : "成员"}</Badge>
          </span>
        </SettingsRow>
        <SettingsRow
          description={`行权限：能查哪些${me.access_scope.title}的数据。`}
          label={`数据权限（可查${me.access_scope.title}）`}
        >
          {scopeLabel(me.access_scope)}
        </SettingsRow>
      </SettingsCard>
      <SettingsGroupTitle>当前权限</SettingsGroupTitle>
      <SettingsCard>
        <ul className="space-y-2 text-sm">
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

/* ─── API Key ─── */

type ApiKeyRow = {
  id: string;
  name: string | null;
  start: string | null;
  enabled: boolean;
  createdAt: string | Date;
  expiresAt: string | Date | null;
  lastRequest: string | Date | null;
};

const DAY = 60 * 60 * 24;
const EXPIRY_OPTIONS: readonly { label: string; seconds: number | null }[] = [
  { label: "永不过期", seconds: null },
  { label: "30 天", seconds: 30 * DAY },
  { label: "90 天", seconds: 90 * DAY },
  { label: "1 年", seconds: 365 * DAY },
];

function fmt(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("zh-CN", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function KeysPage() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  // 列表按签发时间倒序（服务端给的顺序），不做表头排序：一个人手里就那么几把 key。
  const rows = keys ?? [];

  async function load() {
    setError(null);
    const { data, error: err } = await authClient.apiKey.list();
    if (err) {
      setError(authErrorText(err));
      return;
    }
    setKeys(data?.apiKeys ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke(k: ApiKeyRow) {
    setError(null);
    const { error: err } = await authClient.apiKey.delete({ keyId: k.id });
    if (err) {
      setError(authErrorText(err));
      return;
    }
    toastManager.add({ type: "success", title: `已吊销「${k.name || "未命名"}」` });
    await load();
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
          <CircleAlertIcon />
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
                    {fmt(k.createdAt)}
                  </TableCell>
                  <TableCell className="hidden text-pa-muted text-sm md:table-cell">
                    {fmt(k.lastRequest)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {k.expiresAt == null ? (
                      <span className="text-pa-muted">永不</span>
                    ) : expired ? (
                      <Badge variant="warning">已过期</Badge>
                    ) : (
                      <span className="text-pa-muted">{fmt(k.expiresAt)}</span>
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

      <CreateKeyDialog open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />

      <AlertDialog open={revokeTarget != null} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>吊销「{revokeTarget?.name || "未命名"}」？</AlertDialogTitle>
            <AlertDialogDescription>
              正在用这把 key 接入的客户端或脚本会立即断连，且无法恢复——需重新签发一把新 key。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="subtle" />}>取消</AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="danger"
                  onClick={() => {
                    if (revokeTarget) void revoke(revokeTarget);
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

function CreateKeyDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [expiryIdx, setExpiryIdx] = useState(0);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ key: string; name: string } | null>(null);
  const [saved, setSaved] = useState(false);

  function reset() {
    setName("");
    setExpiryIdx(0);
    setFormError(null);
    setIssued(null);
    setSaved(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setFormError(null);
    const expiresIn = EXPIRY_OPTIONS[expiryIdx].seconds;
    const { data, error: err } = await authClient.apiKey.create({
      name: name.trim(),
      ...(expiresIn != null ? { expiresIn } : {}),
    });
    setPending(false);
    if (err || !data?.key) {
      setFormError(authErrorText(err) ?? "创建失败");
      return;
    }
    setIssued({ key: data.key, name: name.trim() });
    await onCreated();
  }

  // 明文在场且尚未确认保存时，把弹层的所有自动关闭路径都掐掉。
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
                  loading={pending}
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
        <Alert variant="info">
          <CircleAlertIcon />
          <AlertTitle>只显示这一次</AlertTitle>
          <AlertDescription>关闭这个窗口之后，这串明文就再也取不回来了。</AlertDescription>
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
