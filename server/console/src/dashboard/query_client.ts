/** 4xx 一律不重试：未登录整页跳登录先于此在 getJson 内发生。 */
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
