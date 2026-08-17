/**
 * 控制台服务端资源的取数缓存基座（TanStack Query）。缓存里只存 api.ts 经 Zod 校验后的
 * 契约类型；未登录整页跳登录仍先于此在 getJson 内发生，故 4xx 一律不重试。
 */
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status < 500) && failureCount < 2,
      },
    },
  });
}
