export type RequestToken = number;

export function createRequestCoordinator() {
  let revision = 0;
  let closed = false;

  const invalidate = (): void => {
    revision += 1;
  };

  const begin = (): RequestToken | null => {
    if (closed) return null;
    revision += 1;
    return revision;
  };

  const isCurrent = (token: RequestToken): boolean => !closed && token === revision;

  const close = (): void => {
    closed = true;
    invalidate();
  };

  return {
    begin,
    invalidate,
    isCurrent,
    close,
    isClosed: () => closed,
  };
}
