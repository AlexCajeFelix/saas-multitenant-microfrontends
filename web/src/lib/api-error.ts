/** Codigos que o backend devolve em `error.code`. */
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BUSINESS_RULE_VIOLATION"
  | "INFRASTRUCTURE_ERROR"
  | "INTERNAL_ERROR"
  | "MODULE_NOT_FOUND"
  | "WORKER_BOOT_FAILED"
  | "NETWORK_ERROR";

export interface LimitViolation {
  resource: string;
  limit: number;
  current: number;
}

/**
 * O envelope de erro do backend virando objeto.
 *
 *   { "error": { "code", "message", "details" }, "requestId": "..." }
 *
 * O `requestId` e irmao de `error`, nao filho — e e ele que casa com a linha
 * correspondente em `make logs`.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(init: {
    code: ApiErrorCode;
    message: string;
    status: number;
    details?: Record<string, unknown>;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status;
    this.details = init.details ?? {};
    this.requestId = init.requestId ?? null;
  }

  /** Erros de campo de um 422, no formato { campo: motivo }. */
  get fieldErrors(): Record<string, string> {
    const fields = this.details.fields;
    if (!fields || typeof fields !== "object") return {};
    return fields as Record<string, string>;
  }

  /** Violacoes de limite de plano de um 409 de regra de negocio. */
  get violations(): LimitViolation[] {
    const raw = this.details.violations;
    return Array.isArray(raw) ? (raw as LimitViolation[]) : [];
  }

  /** Permissoes que faltaram, quando o 403 veio de `requirePermission`. */
  get missingPermissions(): string[] {
    const raw = this.details.missing;
    return Array.isArray(raw) ? (raw as string[]) : [];
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
