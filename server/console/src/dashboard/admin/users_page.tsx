/**
 * 成员（admin）：列表 / 新建 / 配权（数据角色 + 授权范围）/ 重置密码。
 * 权限边界始终是服务端守卫，隐藏 UI 不构成授权。
 */
import { useEffect, useMemo, useState } from "react";
import { CircleAlertIcon, KeyRoundIcon, PlusIcon, ShieldIcon } from "lucide-react";
import type { AccessScope } from "@contracts/access_scope";
import type { MePayload } from "@contracts/session_contract";
import {
  ACCESS_ROLE_SCHEMA,
  type AccessRole,
  type AdminUser,
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
import {
  errorText,
  useCreateUser,
  useResetUserPassword,
  useUpdateUserAuthorization,
  useUsers,
} from "../dashboard_queries";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RowBadge } from "../kit/settings_kit";
import {
  ListControlBar,
  ListControlCategory,
  ListControlSearch,
  useSetTitlebarActions,
} from "../layout/layout_chrome";
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

function initialOf(user: AdminUser): string {
  return (user.name.trim().charAt(0) || user.email.charAt(0) || "?").toUpperCase();
}

export function UsersPage({ me }: { me: MePayload }) {
  const usersQuery = useUsers();
  const users = usersQuery.data?.users ?? null;
  const error = errorText(usersQuery.error);
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

  useSetTitlebarActions(
    () => (
      <HeaderTextAction onClick={() => setShowCreate(true)}>
        <PlusIcon aria-hidden="true" />
        新增用户
      </HeaderTextAction>
    ),
    [],
  );

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
                    {/* 角色是系统给的固定档，与邮箱、授权范围同排普通文本，不摆胶囊。 */}
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
      />
      <GrantDialog
        user={grantTarget}
        meEmail={me.email}
        accessScopeTitle={me.access_scope.title}
        onClose={() => setGrantTarget(null)}
      />
      <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} />
    </>
  );
}

function GrantDialog({
  user,
  meEmail,
  accessScopeTitle,
  onClose,
}: {
  user: AdminUser | null;
  meEmail: string;
  accessScopeTitle: string;
  onClose: () => void;
}) {
  const [role, setRole] = useState<AccessRole>("user");
  const [scope, setScope] = useState("");
  const update = useUpdateUserAuthorization();
  const { reset: resetUpdate } = update;
  const formError = errorText(update.error);
  const self = user?.email === meEmail;

  useEffect(() => {
    if (!user) return;
    setRole(user.role);
    setScope(scopeInput(user.access_scope));
    resetUpdate();
  }, [user, resetUpdate]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    update.mutate(
      { id: user.id, body: { role, access_scope: scopeFromInput(scope) } },
      { onSuccess: onClose },
    );
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
            <Button variant="filled" type="submit" loading={update.isPending}>
              保存
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const resetPassword = useResetUserPassword();
  const { reset: resetMutation } = resetPassword;
  const formError = errorText(resetPassword.error);

  useEffect(() => {
    if (!user) return;
    setPassword("");
    resetMutation();
  }, [user, resetMutation]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    resetPassword.mutate(
      { id: user.id, body: { password } },
      {
        onSuccess: () => {
          toastManager.add({
            type: "success",
            title: `已重置「${user.name || user.email}」的密码`,
          });
          onClose();
        },
      },
    );
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
            <Button
              variant="filled"
              type="submit"
              loading={resetPassword.isPending}
              disabled={password.length < 8}
            >
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
}: {
  open: boolean;
  accessScopeTitle: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AccessRole>("user");
  const [accessScope, setAccessScope] = useState("");
  const create = useCreateUser();
  const { reset: resetCreate } = create;
  const formError = errorText(create.error);

  useEffect(() => {
    if (open) resetCreate();
  }, [open, resetCreate]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        email,
        password,
        ...(name.trim() ? { name } : {}),
        role,
        access_scope: scopeFromInput(accessScope),
      },
      {
        onSuccess: () => {
          setEmail("");
          setName("");
          setPassword("");
          setRole("user");
          setAccessScope("");
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* 表单弹层不分栏、不加宽。 */}
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
            <Button
              variant="filled"
              type="submit"
              loading={create.isPending}
              disabled={password.length < 8}
            >
              创建用户
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}
