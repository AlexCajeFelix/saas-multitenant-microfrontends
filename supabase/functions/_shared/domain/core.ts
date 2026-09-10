import { BusinessRuleError, ValidationError } from "./errors.ts";

/**
 * Guarda de invariantes. Usado pelos construtores de value objects e agregados
 * para que nenhum objeto invalido chegue a existir.
 */
export class Guard {
  static required<T>(value: T | null | undefined, field: string): T {
    if (value === null || value === undefined) {
      throw new ValidationError(`${field} e obrigatorio`, { field });
    }
    return value;
  }

  static notBlank(value: string, field: string): string {
    const trimmed = (value ?? "").trim();
    if (trimmed.length === 0) {
      throw new ValidationError(`${field} nao pode ser vazio`, { field });
    }
    return trimmed;
  }

  static length(value: string, field: string, min: number, max: number): string {
    const trimmed = Guard.notBlank(value, field);
    if (trimmed.length < min || trimmed.length > max) {
      throw new ValidationError(`${field} deve ter entre ${min} e ${max} caracteres`, {
        field,
        min,
        max,
        actual: trimmed.length,
      });
    }
    return trimmed;
  }

  static matches(value: string, pattern: RegExp, field: string, hint: string): string {
    if (!pattern.test(value)) {
      throw new ValidationError(`${field} invalido: ${hint}`, { field, hint });
    }
    return value;
  }

  static integer(value: number, field: string): number {
    if (!Number.isInteger(value)) {
      throw new ValidationError(`${field} deve ser um numero inteiro`, { field, value });
    }
    return value;
  }

  static range(value: number, field: string, min: number, max: number): number {
    if (value < min || value > max) {
      throw new ValidationError(`${field} deve estar entre ${min} e ${max}`, {
        field,
        min,
        max,
        value,
      });
    }
    return value;
  }

  static nonNegative(value: number, field: string): number {
    if (value < 0) {
      throw new ValidationError(`${field} nao pode ser negativo`, { field, value });
    }
    return value;
  }

  static oneOf<T extends string>(value: string, allowed: readonly T[], field: string): T {
    if (!allowed.includes(value as T)) {
      throw new ValidationError(`${field} deve ser um de: ${allowed.join(", ")}`, {
        field,
        allowed,
        value,
      });
    }
    return value as T;
  }

  /** Invariante de agregado: falhou uma regra, nao uma validacao de formato. */
  static rule(condition: boolean, message: string, details: Record<string, unknown> = {}): void {
    if (!condition) {
      throw new BusinessRuleError(message, details);
    }
  }
}

/**
 * Value object: identidade pela composicao dos atributos, nunca por id.
 * Imutavel por construcao.
 */
export abstract class ValueObject<T extends Record<string, unknown>> {
  protected readonly props: Readonly<T>;

  protected constructor(props: T) {
    this.props = Object.freeze({ ...props });
  }

  equals(other?: ValueObject<T> | null): boolean {
    if (!other) return false;
    if (other.constructor !== this.constructor) return false;
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }

  toJSON(): Readonly<T> {
    return this.props;
  }
}

/** Entidade: identidade estavel por id, atributos mutaveis sob controle. */
export abstract class Entity<T extends Record<string, unknown>> {
  protected readonly _id: string;
  protected props: T;

  protected constructor(id: string, props: T) {
    this._id = id;
    this.props = props;
  }

  get id(): string {
    return this._id;
  }

  equals(other?: Entity<T> | null): boolean {
    if (!other) return false;
    return other.constructor === this.constructor && other._id === this._id;
  }
}

/**
 * Evento de dominio. Os agregados o enfileiram; o caso de uso pede ao
 * EventPublisher que grave. Nada no dominio conhece o outbox.
 */
export abstract class DomainEvent {
  readonly eventId: string = crypto.randomUUID();
  readonly occurredAt: Date = new Date();

  protected constructor(
    readonly tenantId: string,
    readonly aggregateId: string,
  ) {}

  abstract get name(): string;
  abstract get aggregateType(): string;
  abstract payload(): Record<string, unknown>;
}

/**
 * Raiz de agregado: a unica porta de entrada para modificar o grafo de
 * objetos que ela governa, e a unica que acumula eventos.
 */
export abstract class AggregateRoot<T extends Record<string, unknown>> extends Entity<T> {
  private events: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.events.push(event);
  }

  /** Devolve e limpa a fila. Chamado pelo caso de uso apos persistir. */
  pullEvents(): DomainEvent[] {
    const pending = this.events;
    this.events = [];
    return pending;
  }

  abstract get tenantId(): string;
}
