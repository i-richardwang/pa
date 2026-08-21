/**
 * 报告 / 分析工作台的编辑会话。
 *
 * 种子一到位就落草稿，配置栏恒可用；「改没改」是草稿与基线的差（`dirty`），
 * 它决定有没有可保存的东西、要不要拦离开。
 *
 * 播种代际 = 会话键 × 放弃次数：只有换会话与显式重播种（放弃改动）推进代际，
 * 查询 refetch 换了 `seed` 的引用不算。飞行中的运行结果回来时代际不符即作废。
 *
 * 规格与结果是两条腿：种子只管规格，结果字节另走 `savedReplay` 后到即可；
 * 预览结果住在查询缓存的会话键位下（`useDraftPreview`）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReplayPayload } from "@contracts/replay_contract";
import type { AnalysisDefinition, SemanticViewIntent } from "@semantic-analysis";
import type { ViewPreferences } from "@view-preferences";
import { toastManager } from "@/components/ui/toast";
import { ApiError } from "../api";
import { useCreateReport } from "../dashboard_queries";
import {
  beginAnalysisEdit,
  hasAnalysisChanges,
  hasViewChanges,
  isAnalysisEditDirty,
  isAnalysisRunnable,
  isPreviewCurrent,
  settlePreview,
  settleSaved,
  type AnalysisEditState,
} from "./analysis_draft";
import { reportKeys, useDraftPreview, useRunDraft, useUpdateReport } from "../editor_queries";
import { reportHash, useLeaveBlocker } from "../router";

export type AnalysisEditorSeed = {
  name: string;
  analysis: AnalysisDefinition;
  view: SemanticViewIntent;
  view_preferences?: ViewPreferences;

  hasSavedResult: boolean;
  /** 只有当前用户自有 View 才能直接被报告引用；看板分叉不提供该字段。 */
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
};

export function useAnalysisEditSession({
  sessionKey,
  seed,
  savedReplay = null,
  target,
}: AnalysisEditSessionInput) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AnalysisEditState | null>(null);
  const [baselineRevision, setBaselineRevision] = useState<number | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveResolve = useRef<((ok: boolean) => void) | null>(null);

  const [generation, setGeneration] = useState(0);
  const generationRef = useRef(generation);
  const epoch = `${sessionKey}#${generation}`;
  /** 同步可读的当前代际：放弃改动即刻推进，飞行中的结果据此作废。 */
  const liveEpoch = useRef(epoch);
  liveEpoch.current = epoch;
  const sown = useRef<string | null>(null);

  const updateReport = useUpdateReport(target.kind === "update" ? target.reportId : "");
  const createReport = useCreateReport();
  const runDraft = useRunDraft();
  const previewReplay = useDraftPreview(sessionKey);
  const activeReplay = previewReplay ?? savedReplay;
  const showingSavedReplay = previewReplay === null && savedReplay !== null;

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
  useLeaveBlocker(dirty, confirmLeave);

  const presentationNotes = useMemo(() => {
    if (!activeReplay) return [];
    if (draft && (hasAnalysisChanges(draft) || hasViewChanges(draft)) && !isPreviewCurrent(draft)) {
      return [];
    }
    return activeReplay.presentation_notes ?? [];
  }, [draft, activeReplay]);

  /**
   * 把草稿跑到服务端并落为当前预览；返回新 View 身份。
   * 规格未变时沿用当前结果只铸 View，规格变了才创建 Run。
   */
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
    if (!draft || !isAnalysisRunnable(draft)) return false;
    if (hasAnalysisChanges(draft) || hasViewChanges(draft)) {
      if (!(await run(draft))) return false;
    }
    toastManager.add({ type: "success", title: "预览已更新" });
    return true;
  }

  function discard() {
    generationRef.current += 1;
    liveEpoch.current = `${sessionKey}#${generationRef.current}`;
    setGeneration(generationRef.current);
  }

  /** 可保存的 View 身份：未改动用自有 View，预览已是当前草稿用预览，否则现跑一次。 */
  async function materialize(current: AnalysisEditState): Promise<string | null> {
    if (!hasAnalysisChanges(current) && !hasViewChanges(current) && seed?.ownedViewId) {
      return seed.ownedViewId;
    }
    if (isPreviewCurrent(current) && previewReplay) return previewReplay.view_id;
    return run(current);
  }

  async function save(): Promise<boolean> {
    if (!draft || !seed || !draft.name.trim()) return false;
    try {
      if (target.kind === "update") {
        if (!dirty) return false;
        const ifRevision = baselineRevision ?? target.ifRevision;
        if (!hasAnalysisChanges(draft) && !hasViewChanges(draft)) {
          const renamed = await updateReport.mutateAsync({
            action: { type: "rename", name: draft.name },
            if_revision: ifRevision,
          });
          settle(draft, renamed.revision);
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
        settle(draft, replaced.revision);
        toastManager.add({ type: "success", title: "已保存报告" });
        return true;
      }

      const viewId = await materialize(draft);
      if (!viewId) return false;
      const report = await createReport.mutateAsync({ view_id: viewId, name: draft.name });
      window.location.hash = reportHash(report.id).slice(1);
      toastManager.add({ type: "success", title: `已保存「${report.name}」` });
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

  /** 原地落定：草稿留在屏上成为新基线，乐观锁基线取服务端刚回的版本号。 */
  function settle(saved: AnalysisEditState, revision: number) {
    setDraft((current) => settleSaved(current ?? saved));
    setBaselineRevision(revision);
  }

  async function saveAs(): Promise<boolean> {
    if (!draft || !seed || !draft.name.trim()) return false;
    try {
      const viewId = await materialize(draft);
      if (!viewId) return false;
      const report = await createReport.mutateAsync({ view_id: viewId, name: draft.name });
      window.location.hash = reportHash(report.id).slice(1);
      toastManager.add({ type: "success", title: `已另存为「${report.name}」` });
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
      isAnalysisRunnable(draft) &&
      (target.kind === "create" || isAnalysisEditDirty(draft)),
    canSaveAs:
      target.kind === "update" && !!draft && !!draft.name.trim() && isAnalysisRunnable(draft),
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
