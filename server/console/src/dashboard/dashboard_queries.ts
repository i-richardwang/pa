/**
 * 控制台通用服务端资源的取数与写入（TanStack Query）——报告编辑器族之外的一切：
 * 会话身份、口径目录、维度取值、报告/分析/看板列表与其增删。同一资源多处消费时收口到
 * 一个键位即跨页去重（如目录被报告编辑器/目录页/筛选编辑器、看板列表被列表页/命令面板共用）。
 * 缓存只存 api.ts 经 Zod 校验的契约类型。
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ADD_BOARD_ITEM_PAYLOAD_SCHEMA,
  BOARD_PAYLOAD_SCHEMA,
  BOARDS_PAYLOAD_SCHEMA,
} from "@contracts/board_contract";
import {
  BUSINESS_TERM_SCHEMA,
  BUSINESS_TERMS_PAYLOAD_SCHEMA,
  type CreateBusinessTermBody,
  type UpdateBusinessTermBody,
} from "@contracts/business_term_contract";
import {
  PUBLIC_CATALOG_DOCUMENT_SCHEMA as CATALOG_PAYLOAD_SCHEMA,
  CATALOG_DIMENSION_VALUES_SCHEMA as CATALOG_VALUES_PAYLOAD_SCHEMA,
} from "@contracts/catalog_contract";
import {
  type CreateReportBody,
  REPORT_ROW_PAYLOAD_SCHEMA,
  REPORTS_PAYLOAD_SCHEMA,
} from "@contracts/report_contract";
import { ME_PAYLOAD_SCHEMA } from "@contracts/session_contract";
import { MY_ANALYSES_PAYLOAD_SCHEMA } from "@contracts/analysis_contract";
import { OK_PAYLOAD_SCHEMA } from "@contracts/response_contract";
import { REPLAY_PAYLOAD_SCHEMA } from "@contracts/replay_contract";
import type { TimeIntent } from "@time";
import { ApiError, deleteJson, getJson, postJson, putJson } from "./api";
import { DATA_CAPABILITY_MAP_SCHEMA } from "@data-capability-map";

export const dashboardKeys = {
  me: ["me"] as const,
  catalog: ["catalog"] as const,
  capabilityMap: ["capability_map"] as const,
  businessTerms: ["business_terms"] as const,
  adminBusinessTerms: ["admin_business_terms"] as const,
  dimensionValues: (member: string, contains: string) =>
    ["dimension_values", member, contains] as const,
  reports: ["reports"] as const,
  myAnalyses: (days: number, limit: number, offset: number) =>
    ["my_analyses", days, limit, offset] as const,
  analysisReplay: (id: string) => ["analysis_replay", id] as const,
  boards: ["boards"] as const,
  board: (id: string) => ["board", id] as const,
  /** 板级时间覆盖是键的一部分：结构化值直接进键，TanStack 按结构哈希，不另串成字符串 */
  boardReportReplay: (boardId: string, reportId: string, time: TimeIntent | null = null) =>
    ["board_report_replay", boardId, reportId, time] as const,
  /** 编辑期瓦片走 owner 端点实时预览（草稿新加的瓦片尚未落库，板级端点会 404） */
  boardTilePreview: (reportId: string) => ["board_tile_preview", reportId] as const,
};

/** 已登录整页跳转由 getJson 处理，401 在此不作为可展示错误。 */
export function errorText(error: unknown): string | null {
  if (!error || (error instanceof ApiError && error.status === 401)) return null;
  return error instanceof Error ? error.message : String(error);
}

export function useMe() {
  return useQuery({
    queryKey: dashboardKeys.me,
    queryFn: () => getJson("/dashboard/api/me", ME_PAYLOAD_SCHEMA),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useCatalogQuery(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.catalog,
    enabled,
    queryFn: () => getJson("/dashboard/api/catalog", CATALOG_PAYLOAD_SCHEMA),
  });
}

export function useCapabilityMapQuery(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.capabilityMap,
    enabled,
    queryFn: () => getJson("/dashboard/api/admin/data-capability-map", DATA_CAPABILITY_MAP_SCHEMA),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** 管理端写入后同时失效公共与管理缓存；服务端 Catalog 每次解析都读取最新定义。 */
export function useBusinessTerms(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.businessTerms,
    enabled,
    queryFn: () => getJson("/dashboard/api/catalog/terms", BUSINESS_TERMS_PAYLOAD_SCHEMA),
  });
}

export function useAdminBusinessTerms(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.adminBusinessTerms,
    enabled,
    queryFn: () => getJson("/dashboard/api/admin/business_terms", BUSINESS_TERMS_PAYLOAD_SCHEMA),
  });
}

function useBusinessTermMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.businessTerms });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.adminBusinessTerms });
    },
  });
}

export function useCreateBusinessTerm() {
  return useBusinessTermMutation((body: CreateBusinessTermBody) =>
    postJson("/dashboard/api/admin/business_terms", body, BUSINESS_TERM_SCHEMA),
  );
}

export function useUpdateBusinessTerm() {
  return useBusinessTermMutation(({ id, body }: { id: string; body: UpdateBusinessTermBody }) =>
    putJson(`/dashboard/api/admin/business_terms/${id}`, body, BUSINESS_TERM_SCHEMA),
  );
}

export function useDeleteBusinessTerm() {
  return useBusinessTermMutation((id: string) =>
    deleteJson(`/dashboard/api/admin/business_terms/${encodeURIComponent(id)}`, OK_PAYLOAD_SCHEMA),
  );
}

/**
 * 维度取值现查：与 MCP values_of 同路径、同分类/个体粒度守卫。
 * 值集合随行权限与数据刷新变化，故每次打开重取、不跨开留存（staleTime/gcTime 皆 0）——
 * 缓存会让当前权限下可见的分类值过期。输入去抖期保留上一批结果（只压暗、不清空）。
 */
export function useDimensionValues(member: string, contains: string, enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.dimensionValues(member, contains),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => {
      const params = new URLSearchParams({ member, ...(contains ? { contains } : {}) });
      return getJson(`/dashboard/api/catalog/values?${params}`, CATALOG_VALUES_PAYLOAD_SCHEMA);
    },
  });
}

export function useReportsList(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.reports,
    enabled,
    queryFn: () => getJson("/dashboard/api/reports", REPORTS_PAYLOAD_SCHEMA),
  });
}

/** 本人分析记录，服务端切片分页；翻页/换窗时保留上一页做压暗过渡。 */
export function useMyAnalyses(days: number, limit: number, offset: number, enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.myAnalyses(days, limit, offset),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      getJson(
        `/dashboard/api/usage/mine?days=${days}&limit=${limit}&offset=${offset}`,
        MY_ANALYSES_PAYLOAD_SCHEMA,
      ),
  });
}

/** 按 View 身份以当前浏览者权限重放（结果为当前数据，非当时快照）。 */
export function useAnalysisReplay(id: string) {
  return useQuery({
    queryKey: dashboardKeys.analysisReplay(id),
    queryFn: () =>
      getJson(
        `/dashboard/api/analysis_views/${encodeURIComponent(id)}/replay`,
        REPLAY_PAYLOAD_SCHEMA,
      ),
  });
}

/** 保存 View 身份为独立报告；成功后失效报告列表，让「我的报告」与选择器取到新行。 */
export function useCreateReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReportBody) =>
      postJson("/dashboard/api/reports", body, REPORT_ROW_PAYLOAD_SCHEMA),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.reports });
    },
  });
}

export function useBoards(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.boards,
    enabled,
    queryFn: () => getJson("/dashboard/api/boards", BOARDS_PAYLOAD_SCHEMA),
  });
}

export function useBoard(id: string) {
  return useQuery({
    queryKey: dashboardKeys.board(id),
    queryFn: () => getJson(`/dashboard/api/boards/${encodeURIComponent(id)}`, BOARD_PAYLOAD_SCHEMA),
  });
}

export function boardReportReplayQueryOptions(boardId: string, reportId: string) {
  return {
    queryKey: dashboardKeys.boardReportReplay(boardId, reportId),
    // 编辑器把本次载荷当会话基线；窗口切回不得在用户无动作时替换它。
    refetchOnWindowFocus: false as const,
    queryFn: () =>
      getJson(
        `/dashboard/api/boards/${encodeURIComponent(boardId)}/items/${encodeURIComponent(reportId)}/replay`,
        REPLAY_PAYLOAD_SCHEMA,
      ),
  };
}

export function useBoardReportReplay(boardId: string, reportId: string) {
  return useQuery(boardReportReplayQueryOptions(boardId, reportId));
}

export function useCreateBoard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => postJson("/dashboard/api/boards", { name }, BOARD_PAYLOAD_SCHEMA),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.boards });
    },
  });
}

/** 把报告追加到看板（先取板 revision，再 POST items）。 */
export function useAddReportToBoard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ boardId, reportId }: { boardId: string; reportId: string }) => {
      const board = await getJson(
        `/dashboard/api/boards/${encodeURIComponent(boardId)}`,
        BOARD_PAYLOAD_SCHEMA,
      );
      return postJson(
        `/dashboard/api/boards/${encodeURIComponent(boardId)}/items`,
        { report_id: reportId, if_revision: board.revision },
        ADD_BOARD_ITEM_PAYLOAD_SCHEMA,
      );
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.boards });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.board(variables.boardId) });
    },
  });
}

export function useDeleteBoard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      deleteJson(`/dashboard/api/boards/${encodeURIComponent(id)}`, OK_PAYLOAD_SCHEMA),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.boards });
    },
  });
}
