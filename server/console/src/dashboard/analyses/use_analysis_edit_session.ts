/**
 * 报告 / 分析工作台的编辑会话。
 *
 * `epoch` = 会话键 + 放弃改动次数（`generation`）：只有切换会话和放弃改动会重新载入种子规格，查询 refetch
 * 换了 `seed` 引用不会。运行返回时 `epoch` 已变化的，丢弃其结果。种子只提供规格，已保存结果由
 * `savedReplay` 单独传入，可能晚于种子到达。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReplayPayload } from "@contracts/replay_contract";
import type { PublicCatalogDocument as CatalogPayload } from "@contracts/catalog_contract";
import type { AnalysisDefinition, SemanticViewIntent } from "@semantic-analysis";
import type { ViewPreferences } from "@view-preferences";
import { toastManager } from "@/components/ui/toast";
import { ApiError } from "../api";
import { useCreateReport } from "../dashboard_queries";
import {
  beginAnalysisEdit,
  analysisReadiness,
  hasAnalysisChanges,
  hasViewChanges,
  isAnalysisEditDirty,
  isPreviewCurrent,
  settlePreview,
  settleSaved,
  type AnalysisEditState,
} from "./analysis_draft";
import { reportKeys, useDraftPreview, useRunDraft, useUpdateReport } from "../editor_queries";
import { useLeaveBlocker } from "../router";

export type AnalysisEditorSeed = {
  name: string;
  analysis: AnalysisDefinition;
  view: SemanticViewIntent;
  view_preferences?: ViewPreferences;

  hasSavedResult: boolean;
  /** 只有当前用户自己的 View 才能直接被报告引用；从看板分叉时不提供。 */
  ownedViewId?: string;
};

export type AnalysisEditorTarget =
  | { kind: "create" }
  | { kind: "update"; reportId: string; ifRevision: number };

type AnalysisEditSessionInput = {
  sessionKey: string;
  seed: AnalysisEditorSeed | null;

  savedReplay?: ReplayPayload | null;
  target: AnalysisEditorTarget;
  catalog: CatalogPayload | null;
  /** 新建或另存出新报告后跳转到哪里由调用页面决定。 */
  onCreated: (report: { id: string; name: string }) => void;
};

export function useAnalysisEditSession({
  sessionKey,
  seed,
  savedReplay = null,
  target,
  catalog,
  onCreated,
}: AnalysisEditSessionInput) {
  const queryClient = useQueryClient();
  const [draft, setDraftState] = useState<AnalysisEditState | null>(null);
  /** 草稿的同步副本：离开守卫读它，保存或放弃后立即反映最新状态，不等重新渲染。 */
  const draftRef = useRef<AnalysisEditState | null>(null);
  const setDraft = useCallback<typeof setDraftState>((next) => {
    draftRef.current = typeof next === "function" ? next(draftRef.current) : next;
    setDraftState(draftRef.current);
  }, []);
  const [baselineRevision, setBaselineRevision] = useState<number | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveResolve = useRef<((ok: boolean) => void) | null>(null);

  const [generation, setGeneration] = useState(0);
  const generationRef = useRef(generation);
  const epoch = `${sessionKey}#${generation}`;
  /** 同步可读的当前 generation：放弃改动时立即更新，用于丢弃进行中运行的结果。 */
  const liveEpoch = useRef(epoch);
  liveEpoch.current = epoch;
  const sown = useRef<string | null>(null);

  const updateReport = useUpdateReport(target.kind === "update" ? target.reportId : "");
  const createReport = useCreateReport();
  const runDraft = useRunDraft();
  const previewReplay = useDraftPreview(sessionKey);
  const activeReplay = previewReplay ?? savedReplay;
  const showingSavedReplay = previewReplay === null && savedReplay !== null;
  const canExecute = (current: AnalysisEditState) =>
    catalog !== null && analysisReadiness(current, catalog).issues.length === 0;

  const initialRevision = target.kind === "update" ? target.ifRevision : null;
  useEffect(() => {
    if (sown.current === epoch) return;
    queryClient.removeQueries({ queryKey: reportKeys.draftPreview(sessionKey) });
    setLeaveOpen(false);
    leaveResolve.current = null;
    if (!seed) {
      setDraft(null);
      setBaselineRevision(null);
      return;
    }
    sown.current = epoch;
    setBaselineRevision(initialRevision);
    setDraft(beginAnalysisEdit(seed, seed.hasSavedResult));
  }, [epoch, seed, sessionKey, initialRevision, queryClient]);

  const dirty = !!draft && isAnalysisEditDirty(draft);
  const confirmLeave = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        leaveResolve.current = resolve;
        setLeaveOpen(true);
      }),
    [],
  );
  const wouldLoseWork = useCallback(
    () => !!draftRef.current && isAnalysisEditDirty(draftRef.current),
    [],
  );
  useLeaveBlocker(wouldLoseWork, confirmLeave);

  const presentationNotes = useMemo(() => {
    if (!activeReplay) return [];
    if (draft && (hasAnalysisChanges(draft) || hasViewChanges(draft)) && !isPreviewCurrent(draft)) {
      return [];
    }
    return activeReplay.presentation_notes ?? [];
  }, [draft, activeReplay]);

  /** 在服务端运行草稿并设为当前预览，返回新 View id；分析规格未变时复用当前结果只新建 View。 */
  async function run(current: AnalysisEditState): Promise<string | null> {
    const started = liveEpoch.current;
    try {
      const next = await runDraft.mutateAsync({
        analysis: current.analysis,
        view: current.view,
        view_preferences: current.view_preferences,
        base: hasAnalysisChanges(current) ? null : activeReplay,
      });
      if (liveEpoch.current !== started) return null;
      queryClient.setQueryData(reportKeys.draftPreview(sessionKey), next);
      setDraft(settlePreview(current, next));
      return next.view_id;
    } catch (reason) {
      if (liveEpoch.current !== started) return null;
      if (reason instanceof ApiError && reason.status === 401) return null;
      toastManager.add({
        type: "error",
        title: "预览失败",
        description: reason instanceof Error ? reason.message : String(reason),
      });
      return null;
    }
  }

  async function runPreview(): Promise<boolean> {
    if (!draft || !canExecute(draft)) return false;
    if (hasAnalysisChanges(draft) || hasViewChanges(draft)) {
      if (!(await run(draft))) return false;
    }
    toastManager.add({ type: "success", title: "预览已更新" });
    return true;
  }

  /** 先清空草稿再递增 generation，由上面的 effect 重新载入种子规格。 */
  function discard() {
    generationRef.current += 1;
    liveEpoch.current = `${sessionKey}#${generationRef.current}`;
    setDraft(null);
    setGeneration(generationRef.current);
  }

  /** 保存用的 View id：未改动时用自己的 View，预览与草稿一致时用预览，否则重新运行。 */
  async function materialize(current: AnalysisEditState): Promise<string | null> {
    if (!canExecute(current)) return null;
    if (!hasAnalysisChanges(current) && !hasViewChanges(current) && seed?.ownedViewId) {
      return seed.ownedViewId;
    }
    if (isPreviewCurrent(current) && previewReplay) return previewReplay.view_id;
    return run(current);
  }

  async function save(): Promise<boolean> {
    if (!draft || !seed || !draft.name.trim() || !canExecute(draft)) return false;
    try {
      if (target.kind === "update") {
        if (!dirty) return false;
        const ifRevision = baselineRevision ?? target.ifRevision;
        if (!hasAnalysisChanges(draft) && !hasViewChanges(draft)) {
          const renamed = await updateReport.mutateAsync({
            action: { type: "rename", name: draft.name },
            if_revision: ifRevision,
          });
          settle(renamed.revision);
          toastManager.add({ type: "success", title: "已保存报告" });
          return true;
        }
        const viewId = await materialize(draft);
        if (!viewId) return false;
        const replaced = await updateReport.mutateAsync({
          action: {
            type: "replace_view",
            view_id: viewId,
            ...(draft.name !== draft.baseline_name ? { name: draft.name } : {}),
          },
          if_revision: ifRevision,
        });
        settle(replaced.revision);
        toastManager.add({ type: "success", title: "已保存报告" });
        return true;
      }

      const viewId = await materialize(draft);
      if (!viewId) return false;
      const report = await createReport.mutateAsync({ view_id: viewId, name: draft.name });
      settle();
      toastManager.add({ type: "success", title: `已保存「${report.name}」` });
      onCreated(report);
      return true;
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) return false;
      const conflict = reason instanceof ApiError && reason.status === 409;
      toastManager.add({
        type: "error",
        title: conflict ? "报告已被其他操作更新" : "保存失败",
        description: conflict
          ? "请重新加载后再编辑，当前草稿没有覆盖服务器上的新版本。"
          : reason instanceof Error
            ? reason.message
            : String(reason),
      });
      return false;
    }
  }

  /**
   * 保存后把当前草稿设为新基线，离开守卫随之不再拦截。
   * 只有原地更新才更新乐观锁 revision；新建和另存保存的不是 `target`，revision 不变。
   */
  function settle(revision?: number) {
    setDraft((current) => (current ? settleSaved(current) : current));
    if (revision !== undefined) setBaselineRevision(revision);
  }

  async function saveAs(): Promise<boolean> {
    if (!draft || !seed || !draft.name.trim() || !canExecute(draft)) return false;
    try {
      const viewId = await materialize(draft);
      if (!viewId) return false;
      const report = await createReport.mutateAsync({ view_id: viewId, name: draft.name });
      settle();
      toastManager.add({ type: "success", title: `已另存为「${report.name}」` });
      onCreated(report);
      return true;
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) return false;
      toastManager.add({
        type: "error",
        title: "另存失败",
        description: reason instanceof Error ? reason.message : String(reason),
      });
      return false;
    }
  }

  function resolveLeave(ok: boolean) {
    leaveResolve.current?.(ok);
    leaveResolve.current = null;
    setLeaveOpen(false);
    if (ok) discard();
  }

  return {
    draft,
    setDraft,
    dirty,
    activeReplay,
    showingSavedReplay,

    resultPending: seed?.hasSavedResult === true && activeReplay === null,
    presentationNotes,
    saving: updateReport.isPending || createReport.isPending || runDraft.isPending,
    previewing: runDraft.isPending,
    canSave:
      !!draft &&
      !!seed &&
      !!draft.name.trim() &&
      canExecute(draft) &&
      (target.kind === "create" || isAnalysisEditDirty(draft)),
    canSaveAs: target.kind === "update" && !!draft && !!draft.name.trim() && canExecute(draft),
    leaveOpen,
    target,
    runPreview,
    discard,
    save,
    saveAs,
    resolveLeave,
  };
}

export type AnalysisEditSession = ReturnType<typeof useAnalysisEditSession>;
