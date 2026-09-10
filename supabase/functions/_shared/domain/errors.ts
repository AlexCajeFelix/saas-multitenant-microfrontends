/**
 * Erros de dominio.
 *
 * Toda excecao que sobe das camadas de dominio e de aplicacao carrega o codigo
 * e o status HTTP que a devem representar na borda. O ErrorPresenter da camada
 * HTTP so traduz; nenhuma regra de negocio precisa conhecer o protocolo.
 */
export abstract class DomainError extends Error {
  readonly details: Record<string, unknown>;

  protected constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
  }

  abstract get code(): string;
  abstract get status(): number;

  toJSON(): Record<string, unknown> {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/** Entrada malformada: falha de schema, formato ou invariante de value object. */
export class ValidationError extends DomainError {
  constructor(message = "Requisicao invalida", details: Record<string, unknown> = {}) {
    super(message, details);
  }
  override get code(): string {
    return "VALIDATION_ERROR";
  }
  override get status(): number {
    return 422;
  }
}

/** O recurso nao existe, ou existe em outro tenant (o que da no mesmo aqui). */
export class NotFoundError extends DomainError {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} ${id} nao encontrado` : `${resource} nao encontrado`, {
      resource,
      id,
    });
  }
  override get code(): string {
    return "NOT_FOUND";
  }
  override get status(): number {
    return 404;
  }
}

/** Conflito com o estado atual: duplicidade, concorrencia, unicidade. */
export class ConflictError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
  override get code(): string {
    return "CONFLICT";
  }
  override get status(): number {
    return 409;
  }
}

/** Uma regra de negocio recusou a operacao, ainda que a entrada esteja correta. */
export class BusinessRuleError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
  override get code(): string {
    return "BUSINESS_RULE_VIOLATION";
  }
  override get status(): number {
    return 409;
  }
}

/** Sem credencial, ou credencial ilegivel. */
export class UnauthorizedError extends DomainError {
  constructor(message = "Autenticacao necessaria", details: Record<string, unknown> = {}) {
    super(message, details);
  }
  override get code(): string {
    return "UNAUTHORIZED";
  }
  override get status(): number {
    return 401;
  }
}

/** Autenticado, mas sem permissao no tenant corrente. */
export class ForbiddenError extends DomainError {
  constructor(message = "Acesso negado", details: Record<string, unknown> = {}) {
    super(message, details);
  }
  override get code(): string {
    return "FORBIDDEN";
  }
  override get status(): number {
    return 403;
  }
}

/** Falha do adaptador: banco fora, resposta inesperada, timeout. */
export class InfrastructureError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
  override get code(): string {
    return "INFRASTRUCTURE_ERROR";
  }
  override get status(): number {
    return 500;
  }
}
