/**
 * 报告 / 分析工作台的编辑会话。
 *
 * 播种代际 = 会话键 × 放弃次数：只有换会话与显式重播种（放弃改动）推进代际，
 * 查询 refetch 换了 `seed` 的引用不算；飞行中的运行结果回来时代际不符即作废。
 *
 * 规格与结果是两条腿：种子只管规格，结果字节另走 `savedReplay` 后到即可。
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
import { useLeaveBlocker } from "../router";

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
  /** 新建与另存产生新报告后的去向由宿主页裁决；保存只负责落库与落定基线。 */
  onCreated: (report: { id: string; name: string }) => void;
};

export function useAnalysisEditSession({
  sessionKey,
  seed,
  savedReplay = null,
  target,
  onCreated,
}: AnalysisEditSessionInput) {
  const queryClient = useQueryClient();
  const [draft, setDraftState] = useState<AnalysisEditState | null>(null);
  /** 草稿的同步镜像：离开守卫在被问到时读它，答案不落后于刚落库/刚弃稿的那一拍。 */
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

  /** 弃稿即刻生效：先扔掉草稿再推代际，重新播种由代际那条效果接手。 */
  function discard() {
    generationRef.current += 1;
    liveEpoch.current = `${sessionKey}#${generationRef.current}`;
    setDraft(null);
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
   * 落定：屏上草稿已落库，即刻成为新基线——离开守卫据此不再认为有工作会丢。
   * 原地更新才推进乐观锁基线；新建与另存的落库对象不是 `target`，其基线保持不动。
   */
  function settle(revision?: number) {
    setDraft((current) => (current ? settleSaved(current) : current));
    if (revision !== undefined) setBaselineRevision(revision);
  }

  async function saveAs(): Promise<boolean> {
    if (!draft || !seed || !draft.name.trim()) return false;
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
