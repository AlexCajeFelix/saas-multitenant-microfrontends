import { Guard, ValueObject } from "./core.ts";
import { ValidationError } from "./errors.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Identificador opaco em UUID. Subclasses dao significado ao tipo. */
export abstract class Identifier extends ValueObject<{ value: string }> {
  protected constructor(value: string, field: string) {
    super({ value: Guard.matches(String(value).toLowerCase(), UUID_PATTERN, field, "uuid") });
  }

  get value(): string {
    return this.props.value;
  }

  override toJSON(): { value: string } {
    return this.props;
  }

  override toString(): string {
    return this.props.value;
  }
}

export class TenantId extends Identifier {
  static create(value: string): TenantId {
    return new TenantId(value, "tenantId");
  }
  static generate(): TenantId {
    return new TenantId(crypto.randomUUID(), "tenantId");
  }
}

export class UserId extends Identifier {
  static create(value: string): UserId {
    return new UserId(value, "userId");
  }
}

/** Identificador generico de entidade, para agregados que nao precisam de tipo proprio. */
export class EntityId extends Identifier {
  static create(value: string): EntityId {
    return new EntityId(value, "id");
  }
  static generate(): EntityId {
    return new EntityId(crypto.randomUUID(), "id");
  }
}

export class Email extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): Email {
    const normalized = Guard.notBlank(raw, "email").toLowerCase();
    Guard.matches(normalized, EMAIL_PATTERN, "email", "formato usuario@dominio.tld");
    Guard.length(normalized, "email", 5, 254);
    return new Email(normalized);
  }

  get value(): string {
    return this.props.value;
  }
  get domain(): string {
    return this.props.value.split("@")[1];
  }
  override toString(): string {
    return this.props.value;
  }
}

/** Identificador legivel e estavel do tenant na URL. */
export class Slug extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): Slug {
    const normalized = Guard.notBlank(raw, "slug").toLowerCase();
    Guard.matches(
      normalized,
      SLUG_PATTERN,
      "slug",
      "minusculas, numeros e hifen, entre 3 e 48 caracteres",
    );
    return new Slug(normalized);
  }

  /** Deriva um slug a partir de um nome livre, para sugerir ao usuario. */
  static fromName(name: string): Slug {
    const normalized = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "");
    return Slug.create(normalized.length >= 3 ? normalized : `${normalized}-org`);
  }

  get value(): string {
    return this.props.value;
  }
  override toString(): string {
    return this.props.value;
  }
}

/**
 * Dinheiro em centavos inteiros. Nunca em ponto flutuante, e nunca somando
 * moedas diferentes: as duas causas classicas de erro de arredondamento.
 */
export class Money extends ValueObject<{ cents: number; currency: string }> {
  private constructor(cents: number, currency: string) {
    super({ cents, currency });
  }

  static fromCents(cents: number, currency = "BRL"): Money {
    Guard.integer(cents, "cents");
    const code = Guard.matches(currency.toUpperCase(), CURRENCY_PATTERN, "currency", "ISO 4217");
    return new Money(cents, code);
  }

  static fromUnits(units: number, currency = "BRL"): Money {
    return Money.fromCents(Math.round(units * 100), currency);
  }

  static zero(currency = "BRL"): Money {
    return Money.fromCents(0, currency);
  }

  get cents(): number {
    return this.props.cents;
  }
  get currency(): string {
    return this.props.currency;
  }
  get units(): number {
    return this.props.cents / 100;
  }
  get isZero(): boolean {
    return this.props.cents === 0;
  }
  get isNegative(): boolean {
    return this.props.cents < 0;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new ValidationError("Nao e possivel operar sobre moedas diferentes", {
        left: this.currency,
        right: other.currency,
      });
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromCents(this.cents + other.cents, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromCents(this.cents - other.cents, this.currency);
  }

  multiply(factor: number): Money {
    return Money.fromCents(Math.round(this.cents * factor), this.currency);
  }

  /** Fracao do valor, arredondada para o centavo. Usada no rateio de plano. */
  prorate(ratio: number): Money {
    Guard.range(ratio, "ratio", 0, 1);
    return this.multiply(ratio);
  }

  percentage(percent: number): Money {
    return Money.fromCents(Math.round((this.cents * percent) / 100), this.currency);
  }

  compareTo(other: Money): number {
    this.assertSameCurrency(other);
    return this.cents === other.cents ? 0 : this.cents < other.cents ? -1 : 1;
  }

  greaterThan(other: Money): boolean {
    return this.compareTo(other) > 0;
  }

  format(locale = "pt-BR"): string {
    return new Intl.NumberFormat(locale, { style: "currency", currency: this.currency }).format(
      this.units,
    );
  }

  override toString(): string {
    return `${this.currency} ${this.units.toFixed(2)}`;
  }
}

/** Quantidade inteira positiva. */
export class Quantity extends ValueObject<{ value: number }> {
  private constructor(value: number) {
    super({ value });
  }

  static create(value: number, field = "quantity"): Quantity {
    Guard.integer(value, field);
    if (value <= 0) {
      throw new ValidationError(`${field} deve ser maior que zero`, { field, value });
    }
    return new Quantity(value);
  }

  get value(): number {
    return this.props.value;
  }
  plus(other: Quantity): Quantity {
    return Quantity.create(this.value + other.value);
  }
}

/** Intervalo fechado no inicio e aberto no fim. Usado em periodos de cobranca. */
export class DateRange extends ValueObject<{ start: string; end: string }> {
  private constructor(start: Date, end: Date) {
    super({ start: start.toISOString(), end: end.toISOString() });
  }

  static create(start: Date, end: Date): DateRange {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new ValidationError("Periodo com data invalida");
    }
    if (end.getTime() <= start.getTime()) {
      throw new ValidationError("O fim do periodo deve ser posterior ao inicio", {
        start: start.toISOString(),
        end: end.toISOString(),
      });
    }
    return new DateRange(start, end);
  }

  /** Periodo mensal a partir de uma data, preservando o dia sempre que possivel. */
  static monthFrom(start: Date, months = 1): DateRange {
    const end = new Date(start.getTime());
    end.setUTCMonth(end.getUTCMonth() + months);
    return DateRange.create(start, end);
  }

  static yearFrom(start: Date, years = 1): DateRange {
    const end = new Date(start.getTime());
    end.setUTCFullYear(end.getUTCFullYear() + years);
    return DateRange.create(start, end);
  }

  get start(): Date {
    return new Date(this.props.start);
  }
  get end(): Date {
    return new Date(this.props.end);
  }
  get totalMs(): number {
    return this.end.getTime() - this.start.getTime();
  }

  contains(moment: Date): boolean {
    const t = moment.getTime();
    return t >= this.start.getTime() && t < this.end.getTime();
  }

  /** Fracao do periodo ainda nao consumida em `moment`. Base do rateio. */
  remainingRatio(moment: Date): number {
    const t = moment.getTime();
    if (t <= this.start.getTime()) return 1;
    if (t >= this.end.getTime()) return 0;
    return (this.end.getTime() - t) / this.totalMs;
  }
}
