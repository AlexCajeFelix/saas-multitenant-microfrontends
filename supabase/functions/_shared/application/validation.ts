import { ValidationError } from "../domain/errors.ts";

/** Erro de um campo isolado, agregado pelo ObjectRule em um ValidationError. */
class FieldError extends Error {
  constructor(readonly path: string, readonly reason: string) {
    super(`${path} ${reason}`);
  }
}

export type Infer<R> = R extends Rule<infer T> ? T : never;
export type Shape = Record<string, Rule<unknown>>;
export type InferShape<S extends Shape> = { [K in keyof S]: Infer<S[K]> };

/**
 * Validador proprio, orientado a objetos e sem dependencia externa. Cada regra
 * e um objeto componivel que sabe converter `unknown` no tipo que promete.
 */
export abstract class Rule<T> {
  protected isOptional = false;
  protected fallback: T | undefined = undefined;

  optional(): Rule<T | undefined> {
    this.isOptional = true;
    return this as unknown as Rule<T | undefined>;
  }

  default(value: T): this {
    this.fallback = value;
    this.isOptional = true;
    return this;
  }

  parse(value: unknown, path = "body"): T {
    if (value === undefined || value === null || value === "") {
      if (this.fallback !== undefined) return this.fallback;
      if (this.isOptional) return undefined as unknown as T;
      throw new FieldError(path, "e obrigatorio");
    }
    return this.check(value, path);
  }

  protected abstract check(value: unknown, path: string): T;

  protected fail(path: string, reason: string): never {
    throw new FieldError(path, reason);
  }
}

export class StringRule extends Rule<string> {
  private minLength = 0;
  private maxLength = 10_000;
  private pattern: RegExp | null = null;
  private patternHint = "";
  private shouldTrim = true;
  private transform: ((v: string) => string) | null = null;

  min(n: number): this {
    this.minLength = n;
    return this;
  }
  max(n: number): this {
    this.maxLength = n;
    return this;
  }
  matching(pattern: RegExp, hint: string): this {
    this.pattern = pattern;
    this.patternHint = hint;
    return this;
  }
  lower(): this {
    this.transform = (v) => v.toLowerCase();
    return this;
  }
  upper(): this {
    this.transform = (v) => v.toUpperCase();
    return this;
  }
  raw(): this {
    this.shouldTrim = false;
    return this;
  }

  protected override check(value: unknown, path: string): string {
    if (typeof value !== "string") this.fail(path, "deve ser texto");
    let out = this.shouldTrim ? value.trim() : value;
    if (this.transform) out = this.transform(out);
    if (out.length < this.minLength) {
      this.fail(path, `deve ter pelo menos ${this.minLength} caracteres`);
    }
    if (out.length > this.maxLength) {
      this.fail(path, `deve ter no maximo ${this.maxLength} caracteres`);
    }
    if (this.pattern && !this.pattern.test(out)) {
      this.fail(path, `deve seguir o formato ${this.patternHint}`);
    }
    return out;
  }
}

export class NumberRule extends Rule<number> {
  private minValue = Number.NEGATIVE_INFINITY;
  private maxValue = Number.POSITIVE_INFINITY;
  private mustBeInteger = false;

  min(n: number): this {
    this.minValue = n;
    return this;
  }
  max(n: number): this {
    this.maxValue = n;
    return this;
  }
  integer(): this {
    this.mustBeInteger = true;
    return this;
  }

  protected override check(value: unknown, path: string): number {
    const parsed = typeof value === "string" ? Number(value) : value;
    if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
      this.fail(path, "deve ser um numero");
    }
    if (this.mustBeInteger && !Number.isInteger(parsed)) {
      this.fail(path, "deve ser um numero inteiro");
    }
    if (parsed < this.minValue) this.fail(path, `deve ser maior ou igual a ${this.minValue}`);
    if (parsed > this.maxValue) this.fail(path, `deve ser menor ou igual a ${this.maxValue}`);
    return parsed;
  }
}

export class BooleanRule extends Rule<boolean> {
  protected override check(value: unknown, path: string): boolean {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    this.fail(path, "deve ser booleano");
  }
}

export class EnumRule<T extends string> extends Rule<T> {
  constructor(private readonly allowed: readonly T[]) {
    super();
  }

  protected override check(value: unknown, path: string): T {
    if (typeof value !== "string" || !this.allowed.includes(value as T)) {
      this.fail(path, `deve ser um de: ${this.allowed.join(", ")}`);
    }
    return value as T;
  }
}

export class IsoDateRule extends Rule<Date> {
  private mustBeFuture = false;

  future(): this {
    this.mustBeFuture = true;
    return this;
  }

  protected override check(value: unknown, path: string): Date {
    if (typeof value !== "string" && !(value instanceof Date)) {
      this.fail(path, "deve ser uma data ISO 8601");
    }
    const parsed = value instanceof Date ? value : new Date(value as string);
    if (Number.isNaN(parsed.getTime())) this.fail(path, "deve ser uma data ISO 8601 valida");
    if (this.mustBeFuture && parsed.getTime() < Date.now() - 86_400_000) {
      this.fail(path, "nao pode estar no passado");
    }
    return parsed;
  }
}

export class ArrayRule<T> extends Rule<T[]> {
  private minItems = 0;
  private maxItems = 500;

  constructor(private readonly item: Rule<T>) {
    super();
  }

  min(n: number): this {
    this.minItems = n;
    return this;
  }
  max(n: number): this {
    this.maxItems = n;
    return this;
  }

  protected override check(value: unknown, path: string): T[] {
    if (!Array.isArray(value)) this.fail(path, "deve ser uma lista");
    if (value.length < this.minItems) this.fail(path, `precisa de ao menos ${this.minItems} itens`);
    if (value.length > this.maxItems) this.fail(path, `aceita no maximo ${this.maxItems} itens`);
    return value.map((entry, index) => this.item.parse(entry, `${path}[${index}]`));
  }
}

export class RecordRule extends Rule<Record<string, unknown>> {
  protected override check(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      this.fail(path, "deve ser um objeto");
    }
    return value as Record<string, unknown>;
  }
}

export class ObjectRule<S extends Shape> extends Rule<InferShape<S>> {
  constructor(private readonly shape: S) {
    super();
  }

  protected override check(value: unknown, path: string): InferShape<S> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      this.fail(path, "deve ser um objeto");
    }
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    const failures: Record<string, string> = {};

    for (const [key, rule] of Object.entries(this.shape)) {
      const fieldPath = path === "body" ? key : `${path}.${key}`;
      try {
        const parsed = rule.parse(source[key], fieldPath);
        if (parsed !== undefined) output[key] = parsed;
      } catch (error) {
        if (error instanceof FieldError) {
          failures[error.path] = error.reason;
        } else if (error instanceof ValidationError) {
          Object.assign(failures, (error.details.fields as Record<string, string>) ?? {});
        } else {
          throw error;
        }
      }
    }

    if (Object.keys(failures).length > 0) {
      throw new ValidationError("Requisicao invalida", { fields: failures });
    }
    return output as InferShape<S>;
  }
}

/**
 * Schema nomeado. `parse` devolve o DTO tipado ou lanca ValidationError com
 * o mapa campo -> motivo, que o ErrorPresenter entrega ao cliente.
 */
export class Schema<S extends Shape> {
  private readonly rule: ObjectRule<S>;

  constructor(shape: S) {
    this.rule = new ObjectRule(shape);
  }

  parse(input: unknown): InferShape<S> {
    return this.rule.parse(input ?? {}, "body");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Fachada de construcao das regras. */
export const V = {
  string: (): StringRule => new StringRule(),
  text: (min: number, max: number): StringRule => new StringRule().min(min).max(max),
  uuid: (): StringRule => new StringRule().lower().matching(UUID, "uuid"),
  email: (): StringRule => new StringRule().lower().matching(EMAIL, "usuario@dominio.tld"),
  slug: (): StringRule =>
    new StringRule().lower().matching(/^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])$/, "slug"),
  number: (): NumberRule => new NumberRule(),
  integer: (): NumberRule => new NumberRule().integer(),
  cents: (): NumberRule => new NumberRule().integer().min(0),
  boolean: (): BooleanRule => new BooleanRule(),
  enumOf: <T extends string>(values: readonly T[]): EnumRule<T> => new EnumRule(values),
  date: (): IsoDateRule => new IsoDateRule(),
  array: <T>(item: Rule<T>): ArrayRule<T> => new ArrayRule(item),
  record: (): RecordRule => new RecordRule(),
  object: <S extends Shape>(shape: S): ObjectRule<S> => new ObjectRule(shape),
  schema: <S extends Shape>(shape: S): Schema<S> => new Schema(shape),
};
