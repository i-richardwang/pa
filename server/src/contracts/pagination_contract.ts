export const DASHBOARD_PAGE_SIZE = 20;
export const MAX_DASHBOARD_PAGE_SIZE = 200;

export function normalizePagination(limit?: number, offset?: number) {
  const finiteInteger = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return {
    limit: Math.min(
      Math.max(finiteInteger(limit, DASHBOARD_PAGE_SIZE), 1),
      MAX_DASHBOARD_PAGE_SIZE,
    ),
    offset: Math.max(finiteInteger(offset, 0), 0),
  };
}
