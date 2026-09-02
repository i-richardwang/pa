import { AuthzError } from "../engine/cube_security.js";
import { SemanticQueryIncompatibleError } from "../engine/semantic_analysis_compiler.js";
import { AnalysisNotFoundError, AnalysisViewNotFoundError } from "../ports/analysis_repository.js";
import { BusinessTermNotFoundError } from "../ports/business_term_repository.js";
import { CubeGatewayError } from "../ports/cube_gateway.js";
import { ReportConflictError, ReportNotFoundError } from "../ports/report_repository.js";
import { AnalysisDefinitionError, ViewIntentError } from "../semantic_core/semantic_analysis.js";
import { TimeSelectionError } from "../semantic_core/time_contract.js";

export type ApplicationErrorCode =
  | "invalid_request"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "limit_exceeded"
  | "unavailable"
  | "internal";

const HTTP_STATUS: Record<ApplicationErrorCode, 400 | 403 | 404 | 409 | 413 | 500 | 503> = {
  invalid_request: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  limit_exceeded: 413,
  unavailable: 503,
  internal: 500,
};

export class ApplicationError extends Error {
  override name = "ApplicationError";

  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    options: { cause?: unknown; details?: Record<string, unknown> } = {},
  ) {
    super(message, { cause: options.cause });
    this.details = options.details;
  }

  readonly details?: Record<string, unknown>;
}

export class InvalidRequestError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("invalid_request", message, { details });
  }
}

export class ForbiddenError extends ApplicationError {
  constructor(message: string) {
    super("forbidden", message);
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message: string) {
    super("not_found", message);
  }
}

export class ConflictError extends ApplicationError {
  constructor(message: string) {
    super("conflict", message);
  }
}

export class LimitExceededError extends ApplicationError {
  constructor(message: string) {
    super("limit_exceeded", message);
  }
}

export class UnavailableError extends ApplicationError {
  constructor(message: string, cause?: unknown) {
    super("unavailable", message, { cause });
  }
}

export type PublicApplicationError = {
  code: ApplicationErrorCode;
  message: string;
  status: 400 | 403 | 404 | 409 | 413 | 500 | 503;
  details?: Record<string, unknown>;
  internal: boolean;
};

/** 所有 transport 共用的错误分类；未知异常一律收口为安全的 internal。 */
export function publicApplicationError(error: unknown): PublicApplicationError {
  let classified: ApplicationError;
  if (error instanceof ApplicationError) {
    classified = error;
  } else if (error instanceof AuthzError) {
    classified = new ForbiddenError(error.message);
  } else if (error instanceof SemanticQueryIncompatibleError) {
    classified = new InvalidRequestError(error.message, { routes: error.routes });
  } else if (error instanceof TimeSelectionError) {
    classified = new InvalidRequestError(error.message, { issue: error.issue });
  } else if (error instanceof AnalysisDefinitionError || error instanceof ViewIntentError) {
    classified = new InvalidRequestError(error.message);
  } else if (
    error instanceof AnalysisNotFoundError ||
    error instanceof AnalysisViewNotFoundError ||
    error instanceof BusinessTermNotFoundError ||
    error instanceof ReportNotFoundError
  ) {
    classified = new NotFoundError(error.message);
  } else if (error instanceof ReportConflictError) {
    classified = new ConflictError(error.message);
  } else if (error instanceof CubeGatewayError) {
    classified = new UnavailableError(error.message, error);
  } else {
    classified = new ApplicationError("internal", "服务暂时无法完成请求，请稍后重试", {
      cause: error,
    });
  }
  return {
    code: classified.code,
    message: classified.message,
    status: HTTP_STATUS[classified.code],
    ...(classified.details ? { details: classified.details } : {}),
    internal: classified.code === "internal" || classified.code === "unavailable",
  };
}
