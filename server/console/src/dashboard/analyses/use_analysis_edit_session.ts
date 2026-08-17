/**
 * 报告 / 分析工作台的编辑会话。
 *
 * **没有「编辑模式」这个东西**：种子一到位就落草稿，配置栏因此恒可用——不存在查看态
 * 与编辑态两棵树。区分「改没改」的是草稿与基线的差（`dirty`），
 * 它决定的是有没有可保存的东西、要不要拦离开，而不是页面长什么样。
 *
 * 播种只发生在**换会话**与**显式重播种**（放弃改动）两处：查询刷新会换 `seed` 的引用，
 * 若跟着重播种，用户正在编辑的草稿会被后台一次静默 refetch 抹掉。
 *
 * **规格与结果是两条腿**：报告页的规格与结果本就是两次取数，把它们并成一个播种条件，
 * 配置栏就得等一份自己不消费的数据。故种子只管规格，结果字节另走 `savedReplay` 后到即可。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReplayPayload } from "@contract";
import type { SemanticAnalysisSpec } from "@semantic-analysis";
import { toastManager } from "@/components/ui/toast";
import { ApiError } from "../api";
import { useCreateReport } from "../dashboard_queries";
import {
  beginAnalysisEdit,
  hasSpecChanges,
  isAnalysisEditDirty,
  isAnalysisRunnable,
  isPreviewCurrent,
  settlePreview,
  settleSaved,
  type AnalysisEditState,
} from "./analysis_draft";
import { usePreviewAnalysis, useUpdateReport } from "../editor_queries";
import { reportHash, useLeaveBlocker } from "../router";

export type AnalysisEditorSeed = {
  name: string;
  spec: SemanticAnalysisSpec;

  hasSavedResult: boolean;
  /** 只有当前用户自有 Analysis 才能直接被报告引用；看板分叉不提供该字段。 */
  ownedAnalysisId?: string;
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
  savedReplay: savedReplayInput = null,
  target,
}: AnalysisEditSessionInput) {
  const [draft, setDraft] = useState<AnalysisEditState | null>(null);
  const [previewReplay, setPreviewReplay] = useState<ReplayPayload | null>(null);
  const [baselineRevision, setBaselineRevision] = useState<number | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveResolve = useRef<((ok: boolean) => void) | null>(null);
  /** 播种代际：只有换会话或显式重播种才推进，查询 refetch 换引用不算。 */
  const [seedGeneration, setSeedGeneration] = useState(0);
  const seededAt = useRef<string | null>(null);
  /** 会话代际：任何清稿都递增；飞行中的预览返回后代际不符即作废，防复活已放弃的草稿。 */
  const editEpoch = useRef(0);

  const updateReport = useUpdateReport(target.kind === "update" ? target.reportId : "");
  const createReport = useCreateReport();
  const previewAnalysis = usePreviewAnalysis();
  const savedReplay = savedReplayInput;
  const activeReplay = previewReplay ?? savedReplay;

  const showingSavedReplay = activeReplay !== null && activeReplay === savedReplay;

  useEffect(() => {
    editEpoch.current += 1;
    seededAt.current = null;
    setDraft(null);
    setPreviewReplay(null);
    setBaselineRevision(null);
    setLeaveOpen(false);
    leaveResolve.current = null;
  }, [sessionKey]);

  useEffect(() => {
    if (!seed) return;
    const stamp = `${sessionKey}#${seedGeneration}`;
    if (seededAt.current === stamp) return;
    seededAt.current = stamp;
    editEpoch.current += 1;
    setPreviewReplay(null);
    setBaselineRevision(target.kind === "update" ? target.ifRevision : null);
    setDraft(beginAnalysisEdit(seed, seed.hasSavedResult));
  }, [seed, sessionKey, seedGeneration, target]);

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

  const preview = useMemo(
    () => ({ presentation: activeReplay?.presentation ?? null, error: null as string | null }),
    [activeReplay],
  );

  const presentationNotes = useMemo(() => {
    if (!activeReplay) return [];
    if (draft && hasSpecChanges(draft) && !isPreviewCurrent(draft)) return [];
    return (activeReplay.presentation_notes ?? []).filter(
      (note) => note.kind !== "unsupported_shape",
    );
  }, [draft, activeReplay]);

  async function previewDraft(current: AnalysisEditState): Promise<{
    analysisId: string;
    replay: ReplayPayload;
    draft: AnalysisEditState;
  } | null> {
    const epoch = editEpoch.current;
    try {
      const next = await previewAnalysis.mutateAsync(current.spec);
      if (epoch !== editEpoch.current) return null;
      const settled = settlePreview(current, next);
      setPreviewReplay(next);
      setDraft(settled);
      return { analysisId: next.analysis_id, replay: next, draft: settled };
    } catch (reason) {
      if (epoch !== editEpoch.current) return null;
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
    const result = await previewDraft(draft);
    if (!result) return false;
    toastManager.add({ type: "success", title: "预览已更新" });
    return true;
  }

  function discard() {
    editEpoch.current += 1;
    setSeedGeneration((generation) => generation + 1);
  }

  async function materialize(current: AnalysisEditState): Promise<string | null> {
    if (!hasSpecChanges(current) && seed?.ownedAnalysisId) return seed.ownedAnalysisId;
    if (isPreviewCurrent(current) && previewReplay) return previewReplay.analysis_id;
    return (await previewDraft(current))?.analysisId ?? null;
  }

  async function save(): Promise<boolean> {
    if (!draft || !seed || !draft.name.trim()) return false;
    try {
      if (target.kind === "update") {
        if (!dirty) return false;
        const ifRevision = baselineRevision ?? target.ifRevision;
        if (!hasSpecChanges(draft)) {
          const renamed = await updateReport.mutateAsync({
            action: { type: "rename", name: draft.name },
            if_revision: ifRevision,
          });
          settle(draft, renamed.revision);
          toastManager.add({ type: "success", title: "已保存报告" });
          return true;
        }
        const analysisId = await materialize(draft);
        if (!analysisId) return false;
        const replaced = await updateReport.mutateAsync({
          action: {
            type: "replace_analysis",
            analysis_id: analysisId,
            ...(draft.name !== draft.baseline_name ? { name: draft.name } : {}),
          },
          if_revision: ifRevision,
        });
        settle(draft, replaced.revision);
        toastManager.add({ type: "success", title: "已保存报告" });
        return true;
      }

      const analysisId = await materialize(draft);
      if (!analysisId) return false;
      const report = await createReport.mutateAsync({ analysis_id: analysisId, name: draft.name });
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
      const analysisId = await materialize(draft);
      if (!analysisId) return false;
      const report = await createReport.mutateAsync({ analysis_id: analysisId, name: draft.name });
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
    preview,
    presentationNotes,
    saving: updateReport.isPending || createReport.isPending || previewAnalysis.isPending,
    previewing: previewAnalysis.isPending,
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
