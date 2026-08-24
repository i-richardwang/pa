/**
 * 控制台通用服务端资源取数（报告编辑器族之外）。同一资源收口到一个键位；
 * 缓存只存 api.ts 经 Zod 校验的契约类型。
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ADD_BOARD_ITEM_PAYLOAD_SCHEMA,
  BOARD_PAYLOAD_SCHEMA,
  BOARDS_PAYLOAD_SCHEMA,
  type UpdateBoardBody,
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
  FEEDBACK_GROUP_PAYLOAD_SCHEMA,
  FEEDBACK_LIST_PAYLOAD_SCHEMA,
  type FeedbackStatus,
} from "@contracts/feedback_contract";
import { DASHBOARD_PAGE_SIZE } from "@contracts/pagination_contract";
import {
  type CreateReportBody,
  REPORT_ROW_PAYLOAD_SCHEMA,
  REPORTS_PAYLOAD_SCHEMA,
} from "@contracts/report_contract";
import { ME_PAYLOAD_SCHEMA } from "@contracts/session_contract";
import { MY_ANALYSES_PAYLOAD_SCHEMA } from "@contracts/analysis_contract";
import { OK_PAYLOAD_SCHEMA } from "@contracts/response_contract";
import { REPLAY_PAYLOAD_SCHEMA } from "@contracts/replay_contract";
import {
  UNANSWERED_PAYLOAD_SCHEMA,
  USAGE_OVERVIEW_PAYLOAD_SCHEMA,
  USAGE_TITLES_PAYLOAD_SCHEMA,
} from "@contracts/usage_contract";
import {
  ADMIN_USER_SCHEMA,
  ADMIN_USERS_PAYLOAD_SCHEMA,
  type CreateAdminUserBody,
  type ResetUserPasswordBody,
  type UpdateUserAuthorizationBody,
} from "@contracts/user_administration_contract";
import type { TimeIntent } from "@time";
import { authClient } from "../auth_client";
import { ApiError, deleteJson, getJson, patchJson, postJson, putJson } from "./api";
import { authErrorText } from "./better_auth_adapter";
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
  /** TanStack 按结构哈希，结构化值可直接进键。 */
  boardReportReplay: (boardId: string, reportId: string, timeOverride: TimeIntent | null) =>
    ["board_report_replay", boardId, reportId, timeOverride] as const,
  users: ["users"] as const,
  apiKeys: ["api_keys"] as const,
  feedback: ["feedback"] as const,
  feedbackPage: (offset: number) => ["feedback", offset] as const,
  usage: (days: number, offset: number) => ["usage", days, offset] as const,
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
 * 维度取值现查（同 MCP values_of 路径与分类/个体粒度守卫）：值集合随行权限变，
 * 不缓存（staleTime/gcTime 皆 0）。输入去抖期保留上一批结果（只压暗、不清空）。
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

export function boardReportReplayQueryOptions(
  boardId: string,
  reportId: string,
  timeOverride: TimeIntent | null,
) {
  const params = timeOverride ? `?time=${encodeURIComponent(JSON.stringify(timeOverride))}` : "";
  return {
    queryKey: dashboardKeys.boardReportReplay(boardId, reportId, timeOverride),
    queryFn: () =>
      getJson(
        `/dashboard/api/boards/${encodeURIComponent(boardId)}/items/${encodeURIComponent(reportId)}/replay${params}`,
        REPLAY_PAYLOAD_SCHEMA,
      ),
  };
}

/** 编辑器把这份载荷当会话基线；窗口切回不得在用户无动作时替换它。 */
export function useBoardReportReplay(boardId: string, reportId: string) {
  return useQuery({
    ...boardReportReplayQueryOptions(boardId, reportId, null),
    refetchOnWindowFocus: false,
  });
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

export function useSaveBoard(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateBoardBody) =>
      patchJson(`/dashboard/api/boards/${encodeURIComponent(id)}`, body, BOARD_PAYLOAD_SCHEMA),
    onSuccess: (updated) => {
      queryClient.setQueryData(dashboardKeys.board(id), updated);
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.boards });
    },
  });
}

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

export function useUsers() {
  return useQuery({
    queryKey: dashboardKeys.users,
    queryFn: () => getJson("/dashboard/api/users", ADMIN_USERS_PAYLOAD_SCHEMA),
  });
}

function useUsersMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.users });
    },
  });
}

export function useCreateUser() {
  return useUsersMutation((body: CreateAdminUserBody) =>
    postJson("/dashboard/api/users", body, ADMIN_USER_SCHEMA),
  );
}

export function useUpdateUserAuthorization() {
  return useUsersMutation(({ id, body }: { id: string; body: UpdateUserAuthorizationBody }) =>
    putJson(
      `/dashboard/api/users/${encodeURIComponent(id)}/authorization`,
      body,
      ADMIN_USER_SCHEMA,
    ),
  );
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ResetUserPasswordBody }) =>
      postJson(`/dashboard/api/users/${encodeURIComponent(id)}/password`, body, OK_PAYLOAD_SCHEMA),
  });
}

export function useApiKeys() {
  return useQuery({
    queryKey: dashboardKeys.apiKeys,
    queryFn: async () => {
      const { data, error } = await authClient.apiKey.list();
      if (error) throw new Error(authErrorText(error) ?? "读取失败");
      return data?.apiKeys ?? [];
    },
  });
}

export type ApiKeyRow = NonNullable<ReturnType<typeof useApiKeys>["data"]>[number];

/** 签发：完整 key 只在响应里出现一次，由调用方展示。 */
export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; expiresIn?: number }) => {
      const { data, error } = await authClient.apiKey.create(input);
      if (error || !data?.key) throw new Error(authErrorText(error) ?? "创建失败");
      return data.key;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.apiKeys });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await authClient.apiKey.delete({ keyId });
      if (error) throw new Error(authErrorText(error) ?? "吊销失败");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.apiKeys });
    },
  });
}

export function useFeedbackPage(offset: number) {
  return useQuery({
    queryKey: dashboardKeys.feedbackPage(offset),
    placeholderData: keepPreviousData,
    queryFn: () =>
      getJson(
        `/dashboard/api/feedback?limit=${DASHBOARD_PAGE_SIZE}&offset=${offset}`,
        FEEDBACK_LIST_PAYLOAD_SCHEMA,
      ),
  });
}

export function useResolveFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      topicKey,
      status,
      note,
    }: {
      topicKey: string;
      status: Exclude<FeedbackStatus, "open">;
      note: string;
    }) =>
      patchJson(
        `/dashboard/api/feedback/${encodeURIComponent(topicKey)}`,
        { status, note },
        FEEDBACK_GROUP_PAYLOAD_SCHEMA,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.feedback });
    },
  });
}

export function useUsage(days: number, offset: number) {
  return useQuery({
    queryKey: dashboardKeys.usage(days, offset),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const [overview, titles, unanswered] = await Promise.all([
        getJson(`/dashboard/api/usage/overview?days=${days}`, USAGE_OVERVIEW_PAYLOAD_SCHEMA),
        getJson(
          `/dashboard/api/usage/titles?days=${days}&limit=${DASHBOARD_PAGE_SIZE}&offset=${offset}`,
          USAGE_TITLES_PAYLOAD_SCHEMA,
        ),
        getJson(`/dashboard/api/usage/unanswered?days=${days}`, UNANSWERED_PAYLOAD_SCHEMA),
      ]);
      return { overview, titles, unanswered };
    },
  });
}
