/** 服务端诊断日志。error 附带原始异常，供运维排查；它从不进入对外响应。 */
export type Logger = {
  info(message: string): void;
  error(message: string, error: unknown): void;
};
