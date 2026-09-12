/**
 * 业务术语编辑器：管理员维护黑话词典的提交面。
 * 关联数据成员只帮 Agent 从解释导航到目录，不参与查询改写。
 */
import { useEffect, useState } from "react";
import type { PublicCatalogMember as CatalogMemberPayload } from "@contracts/catalog_contract";
import { BUSINESS_TERM_LIMITS, type PublicBusinessTerm } from "@contracts/business_term_contract";
import { Alert, AlertTitle } from "@/components/ui/alert";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toastManager } from "@/components/ui/toast";
import { useCreateBusinessTerm, useUpdateBusinessTerm } from "../dashboard_queries";

export function BusinessTermEditorDialog({
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
