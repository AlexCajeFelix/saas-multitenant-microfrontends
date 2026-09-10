import type { DomainEvent } from "../domain/core.ts";
import { Guard } from "../domain/core.ts";

/** Porta de saida: registro estruturado. */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

/** Porta de saida: relogio. Injetado para que o dominio seja testavel. */
export interface Clock {
  now(): Date;
}

/** Porta de saida: geracao de identificadores. */
export interface IdGenerator {
  generate(): string;
}

/** Porta de saida: publicacao dos eventos que os agregados acumularam. */
export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/** Porta de saida: trilha de auditoria. */
export interface AuditTrail {
  record(entry: AuditEntry): Promise<void>;
}

/** Porta de saida: hash de segredos (tokens de convite, chaves de API). */
export interface SecretHasher {
  hash(secret: string): Promise<string>;
  generateSecret(bytes?: number): string;
}

/**
 * Diretorio de membros. E a porta pela qual os modulos iam, projects e billing
 * perguntam sobre o vinculo de um usuario com o tenant, sem depender do
 * agregado Membership do modulo tenancy.
 */
export interface MembershipDirectory {
  isActiveMember(tenantId: string, userId: string): Promise<boolean>;
  roleOf(tenantId: string, userId: string): Promise<string | null>;
  countActiveMembers(tenantId: string): Promise<number>;
}

/** Pedido de pagina, ja normalizado. */
export class PageRequest {
  private constructor(
    readonly page: number,
    readonly size: number,
    readonly sort: string | null,
    readonly ascending: boolean,
  ) {}

  static of(page = 1, size = 25, sort: string | null = null, ascending = false): PageRequest {
    const safePage = Math.max(1, Math.trunc(Number.isFinite(page) ? page : 1));
    const safeSize = Guard.range(
      Math.trunc(Number.isFinite(size) ? size : 25),
      "pageSize",
      1,
      100,
    );
    return new PageRequest(safePage, safeSize, sort, ascending);
  }

  get offset(): number {
    return (this.page - 1) * this.size;
  }

  /** Limite superior do range do PostgREST, que e inclusivo. */
  get rangeEnd(): number {
    return this.offset + this.size - 1;
  }
}

/** Pagina de resultados, com o total informado pelo adaptador. */
export class Page<T> {
  constructor(
    readonly items: readonly T[],
    readonly total: number,
    readonly request: PageRequest,
  ) {}

  map<U>(fn: (item: T) => U): Page<U> {
    return new Page(this.items.map(fn), this.total, this.request);
  }

  toJSON(): Record<string, unknown> {
    const pages = this.request.size > 0 ? Math.ceil(this.total / this.request.size) : 0;
    return {
      items: this.items,
      page: this.request.page,
      pageSize: this.request.size,
      total: this.total,
      totalPages: pages,
      hasNext: this.request.page < pages,
    };
  }
}
