/**
 * 成员（admin）：列表 / 新建 / 配权（数据角色 + 授权范围）/ 重置密码。
 * 承载在设置弹层的一节里（`settings_page.tsx`），不占整页、不进主导航——
 * 它管的是工作区里的人，与账号、API Key 同属设置。
 * 用户读取与写入只消费服务端结构化应用合同。
 * 权限边界始终是服务端守卫，隐藏 UI 不构成授权。
 */
import { useEffect, useMemo, useState } from "react";
import { CircleAlertIcon, KeyRoundIcon, PlusIcon, ShieldIcon } from "lucide-react";
import { OK_PAYLOAD_SCHEMA } from "@contracts/response_contract";
import type { AccessScope } from "@contracts/access_scope";
import type { MePayload } from "@contracts/session_contract";
import {
  ACCESS_ROLE_SCHEMA,
  ADMIN_USERS_PAYLOAD_SCHEMA,
  ADMIN_USER_SCHEMA,
  type AccessRole,
  type AdminUser,
  type CreateAdminUserBody,
  type ResetUserPasswordBody,
  type UpdateUserAuthorizationBody,
} from "@contracts/user_administration_contract";
import { LoadingMark } from "pa-result-view";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MenuItem } from "@/components/ui/menu";
import { toastManager } from "@/components/ui/toast";
import { getJson, postJson, putJson } from "../api";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RowBadge, useSetSettingsActions } from "../kit/settings_kit";
import { ListControlBar, ListControlCategory, ListControlSearch } from "../layout/layout_chrome";
import { HeaderTextAction } from "../layout/view_chrome";
import { RowMenu, SortableHead, useTableSort } from "../kit/table_kit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const DATA_ROLES = [
  { value: "user", label: "分析用户" },
  { value: "admin", label: "管理员" },
] as const;

const ROLE_ITEMS = DATA_ROLES.map((r) => ({ label: r.label, value: r.value }));

const ROLE_FACETS = [{ label: "全部角色", value: "all" }, ...ROLE_ITEMS] as const;

function roleLabel(role: AccessRole): string {
  return DATA_ROLES.find((item) => item.value === role)?.label ?? role;
}

function scopeLabel(accessScope: AccessScope, title: string): string {
  if (accessScope.kind === "all") return `全部${title}`;
  return accessScope.values.length ? accessScope.values.join("、") : "未授权";
}

function scopeInput(accessScope: AccessScope): string {
  return accessScope.kind === "all" ? "*" : accessScope.values.join("\n");
}

function scopeFromInput(value: string): AccessScope {
  const trimmed = value.trim();
  return trimmed === "*"
    ? { kind: "all" }
    : {
        kind: "limited",
        values: value
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
      };
}

const USER_SORT: Record<
  "user" | "email" | "role",
  (u: AdminUser) => string | number | null | undefined
> = {
  user: (u) => u.name,
  email: (u) => u.email,
  role: (u) => roleLabel(u.role),
};

/** 行首圆片里的首字母：有名用名，无名退到邮箱。 */
function initialOf(user: AdminUser): string {
  return (user.name.trim().charAt(0) || user.email.charAt(0) || "?").toUpperCase();
}

export function UsersPage({ me }: { me: MePayload }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [grantTarget, setGrantTarget] = useState<AdminUser | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [roleFacet, setRoleFacet] = useState<"all" | AccessRole>("all");
  const [query, setQuery] = useState("");
  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (users ?? []).filter((u) => {
      if (roleFacet !== "all" && u.role !== roleFacet) return false;
      if (!needle) return true;
      return `${u.name} ${u.email}`.toLowerCase().includes(needle);
    });
  }, [users, roleFacet, query]);
  const { rows, sort, toggle } = useTableSort(users ? matched : undefined, USER_SORT);

  async function load() {
    setError(null);
    try {
      const payload = await getJson("/dashboard/api/users", ADMIN_USERS_PAYLOAD_SCHEMA);
      setUsers(payload.users);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useSetSettingsActions(
    () => (
      <HeaderTextAction onClick={() => setShowCreate(true)}>
        <PlusIcon aria-hidden="true" />
        新增用户
      </HeaderTextAction>
    ),
    [],
  );

  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      {error && (
        <Alert className="mb-6" variant="error">
          <CircleAlertIcon />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      {!users ? (
        <LoadingMark className="py-16" />
      ) : users.length === 0 ? null : (
        <>
          <ListControlBar
            className="mb-4"
            left={
              <ListControlCategory
                aria-label="按角色筛选"
                onValueChange={setRoleFacet}
                options={ROLE_FACETS}
                value={roleFacet}
              />
            }
            right={
              <ListControlSearch
                aria-label="按姓名或邮箱搜索成员"
                onValueChange={setQuery}
                placeholder="搜索成员"
                value={query}
              />
            }
          />
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="用户" k="user" sort={sort} onToggle={toggle} />
                <SortableHead
                  label="邮箱"
                  k="email"
                  sort={sort}
                  onToggle={toggle}
                  className="min-w-[120px]"
                />
                <SortableHead
                  label="角色"
                  k="role"
                  sort={sort}
                  onToggle={toggle}
                  className="min-w-[120px]"
                />
                <TableHead className="min-w-[120px]">有权{me.access_scope.title}</TableHead>
                <TableHead className="min-w-[30px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u) => {
                const self = u.email === me.email;
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <RowBadge>{initialOf(u)}</RowBadge>
                        <span className="min-w-0 truncate font-medium">
                          {u.name}
                          {self && <span className="font-normal text-pa-muted"> （你自己）</span>}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-pa-muted">{u.email}</TableCell>
                    {/*
                      角色不摆胶囊：胶囊在本仓是「资源自己挑的那个归类」的记号（报告的图型、
                      指标的分类），成员的角色不是他挑的，是这套系统给的固定几档，与邮箱、
                      授权范围同属账号属性——同一行里三个属性两种排法，会读成角色更要紧。
                    */}
                    <TableCell className="text-pa-muted">{roleLabel(u.role)}</TableCell>
                    <TableCell className="text-pa-muted">
                      {scopeLabel(u.access_scope, me.access_scope.title)}
                    </TableCell>
                    <TableCell className="relative p-2 text-right">
                      <RowMenu label="用户操作">
                        <MenuItem onClick={() => setGrantTarget(u)}>
                          <ShieldIcon aria-hidden="true" />
                          配权
                        </MenuItem>
                        <MenuItem onClick={() => setResetTarget(u)}>
                          <KeyRoundIcon aria-hidden="true" />
                          重置密码
                        </MenuItem>
                      </RowMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}
      <CreateUserDialog
        open={showCreate}
        accessScopeTitle={me.access_scope.title}
        onClose={() => setShowCreate(false)}
        onCreated={async () => {
          setShowCreate(false);
          await load();
        }}
      />
      <GrantDialog
        user={grantTarget}
        meEmail={me.email}
        accessScopeTitle={me.access_scope.title}
        onClose={() => setGrantTarget(null)}
        onSaved={async () => {
          setGrantTarget(null);
          await load();
        }}
      />
      <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} />
    </>
  );
}

/** 配权：数据角色 + 授权范围，Dialog 表单提交后即时生效 */
function GrantDialog({
  user,
  meEmail,
  accessScopeTitle,
  onClose,
  onSaved,
}: {
  /** 配权目标；null = 关闭 */
  user: AdminUser | null;
  meEmail: string;
  accessScopeTitle: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [role, setRole] = useState<AccessRole>("user");
  const [scope, setScope] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const self = user?.email === meEmail;

  useEffect(() => {
    if (!user) return;
    setRole(user.role);
    setScope(scopeInput(user.access_scope));
    setFormError(null);
  }, [user]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setPending(true);
    setFormError(null);
    const payload: UpdateUserAuthorizationBody = {
      role,
      access_scope: scopeFromInput(scope),
    };
    try {
      await putJson(
        `/dashboard/api/users/${encodeURIComponent(user.id)}/authorization`,
        payload,
        ADMIN_USER_SCHEMA,
      );
    } catch (saveError) {
      setPending(false);
      setFormError(saveError instanceof Error ? saveError.message : String(saveError));
      return;
    }
    setPending(false);
    await onSaved();
  }

  return (
    <Dialog open={user != null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>配权</DialogTitle>
        </DialogHeader>
        <Form className="contents" onSubmit={onSubmit}>
          <DialogPanel className="grid gap-4">
            <DialogDescription>{user?.email}</DialogDescription>

            <Field>
              <Select
                items={ROLE_ITEMS}
                value={role}
                disabled={self}
                onValueChange={(v) => setRole(ACCESS_ROLE_SCHEMA.parse(v))}
              >
                <SelectTrigger label="数据角色">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {ROLE_ITEMS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              {self && (
                <FieldDescription>不能改自己的角色，请让另一位管理员来改。</FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel>有权{accessScopeTitle}（行权限）</FieldLabel>
              <Textarea
                rows={5}
                placeholder={`* 表示全部；限定范围时每行填写一个${accessScopeTitle}值`}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              />
              <FieldDescription>每行一个值，值本身可以包含逗号。</FieldDescription>
            </Field>
            {formError && (
              <Field>
                <FieldError match>{formError}</FieldError>
              </Field>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="subtle" />}>取消</DialogClose>
            <Button variant="filled" type="submit" loading={pending}>
              保存
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}

/** 重置密码：Dialog 表单，提交到服务端用户管理用例。 */
function ResetPasswordDialog({
  user,
  onClose,
}: {
  /** 重置目标；null = 关闭 */
  user: AdminUser | null;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setPassword("");
    setFormError(null);
  }, [user]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setPending(true);
    setFormError(null);
    const payload: ResetUserPasswordBody = { password };
    try {
      await postJson(
        `/dashboard/api/users/${encodeURIComponent(user.id)}/password`,
        payload,
        OK_PAYLOAD_SCHEMA,
      );
    } catch (resetError) {
      setPending(false);
      setFormError(resetError instanceof Error ? resetError.message : String(resetError));
      return;
    }
    setPending(false);
    toastManager.add({ type: "success", title: `已重置「${user.name || user.email}」的密码` });
    onClose();
  }

  return (
    <Dialog open={user != null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>重置密码</DialogTitle>
        </DialogHeader>
        <Form className="contents" onSubmit={onSubmit}>
          <DialogPanel className="grid gap-4">
            <DialogDescription>{user?.email}</DialogDescription>
            <Field>
              <FieldLabel htmlFor="reset-pw">新密码（≥8 位）</FieldLabel>
              <Input
                id="reset-pw"
                type="text"
                autoFocus
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {formError && (
              <Field>
                <FieldError match>{formError}</FieldError>
              </Field>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="subtle" />}>取消</DialogClose>
            <Button variant="filled" type="submit" loading={pending} disabled={password.length < 8}>
              确认重置
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}

function CreateUserDialog({
  open,
  accessScopeTitle,
  onClose,
  onCreated,
}: {
  open: boolean;
  accessScopeTitle: string;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AccessRole>("user");
  const [accessScope, setAccessScope] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setFormError(null);
    const payload: CreateAdminUserBody = {
      email,
      password,
      ...(name.trim() ? { name } : {}),
      role,
      access_scope: scopeFromInput(accessScope),
    };
    try {
      await postJson("/dashboard/api/users", payload, ADMIN_USER_SCHEMA);
    } catch (createError) {
      setPending(false);
      setFormError(createError instanceof Error ? createError.message : String(createError));
      return;
    }
    setPending(false);
    setEmail("");
    setName("");
    setPassword("");
    setRole("user");
    setAccessScope("");
    await onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/*
        表单弹层不分栏、不加宽：字段并排会让眼睛在两列之间来回跳，且「邮箱 / 显示名」
        与「角色 / 授权范围」并不是成对的一件事，摆成一行读起来像它们是。
      */}
      <DialogPopup className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>新增用户</DialogTitle>
        </DialogHeader>
        <Form className="contents" onSubmit={onSubmit}>
          <DialogPanel className="grid gap-4">
            <DialogDescription>
              不填「有权{accessScopeTitle}」的账号查不到任何数据
            </DialogDescription>
            <Field>
              <FieldLabel htmlFor="new-email">邮箱</FieldLabel>
              <Input
                id="new-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-name">显示名（可选）</FieldLabel>
              <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-pw">初始密码（≥8 位）</FieldLabel>
              <Input
                id="new-pw"
                type="text"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Select
              items={ROLE_ITEMS}
              value={role}
              onValueChange={(v) => setRole(ACCESS_ROLE_SCHEMA.parse(v))}
            >
              <SelectTrigger label="角色（可见字段）">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {ROLE_ITEMS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Field>
              <FieldLabel htmlFor="new-scope">有权{accessScopeTitle}（行权限）</FieldLabel>
              <Textarea
                id="new-scope"
                rows={5}
                placeholder={`* 表示全部；限定范围时每行填写一个${accessScopeTitle}值`}
                value={accessScope}
                onChange={(e) => setAccessScope(e.target.value)}
              />
              <FieldDescription>每行一个值，值本身可以包含逗号。</FieldDescription>
            </Field>
            {formError && (
              <Field>
                <FieldError match>{formError}</FieldError>
              </Field>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="subtle" />}>取消</DialogClose>
            <Button variant="filled" type="submit" loading={pending} disabled={password.length < 8}>
              创建用户
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}
