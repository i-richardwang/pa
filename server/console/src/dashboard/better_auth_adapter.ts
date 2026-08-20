export function authErrorText(error: { message?: string } | null | undefined): string | null {
  return error ? (error.message ?? "操作失败") : null;
}
