import { BusinessRuleError, Guard, Money, ValueObject } from "../../_shared/mod.ts";

export type SubscriptionStatusValue = "trialing" | "active" | "past_due" | "cancelled";
export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatusValue[] = [
  "trialing",
  "active",
  "past_due",
  "cancelled",
];

/** Situacao da assinatura. Cancelada e terminal. */
export class SubscriptionStatus extends ValueObject<{ value: SubscriptionStatusValue }> {
  private static readonly TRANSITIONS: Record<
    SubscriptionStatusValue,
    SubscriptionStatusValue[]
  > = {
    trialing: ["active", "cancelled", "past_due"],
    active: ["past_due", "cancelled"],
    past_due: ["active", "cancelled"],
    cancelled: [],
  };

  private constructor(value: SubscriptionStatusValue) {
    super({ value });
  }

  static create(raw: string): SubscriptionStatus {
    return new SubscriptionStatus(Guard.oneOf(raw, SUBSCRIPTION_STATUSES, "status"));
  }
  static of(value: SubscriptionStatusValue): SubscriptionStatus {
    return new SubscriptionStatus(value);
  }

  get value(): SubscriptionStatusValue {
    return this.props.value;
  }
  get isLive(): boolean {
    return this.props.value !== "cancelled";
  }
  get isCancelled(): boolean {
    return this.props.value === "cancelled";
  }

  transitionTo(next: SubscriptionStatusValue): SubscriptionStatus {
    if (next === this.props.value) return this;
    const allowed = SubscriptionStatus.TRANSITIONS[this.props.value];
    if (!allowed.includes(next)) {
      throw new BusinessRuleError(`Assinatura nao vai de ${this.props.value} para ${next}`, {
        from: this.props.value,
        to: next,
        allowed,
      });
    }
    return new SubscriptionStatus(next);
  }
}

export type InvoiceStatusValue = "draft" | "open" | "paid" | "void";
export const INVOICE_STATUSES: readonly InvoiceStatusValue[] = ["draft", "open", "paid", "void"];

export class InvoiceStatus extends ValueObject<{ value: InvoiceStatusValue }> {
  private static readonly TRANSITIONS: Record<InvoiceStatusValue, InvoiceStatusValue[]> = {
    draft: ["open", "void"],
    open: ["paid", "void"],
    paid: [],
    void: [],
  };

  private constructor(value: InvoiceStatusValue) {
    super({ value });
  }

  static create(raw: string): InvoiceStatus {
    return new InvoiceStatus(Guard.oneOf(raw, INVOICE_STATUSES, "status"));
  }
  static draft(): InvoiceStatus {
    return new InvoiceStatus("draft");
  }

  get value(): InvoiceStatusValue {
    return this.props.value;
  }
  get isDraft(): boolean {
    return this.props.value === "draft";
  }
  get isPaid(): boolean {
    return this.props.value === "paid";
  }
  get isFinal(): boolean {
    return this.props.value === "paid" || this.props.value === "void";
  }

  transitionTo(next: InvoiceStatusValue): InvoiceStatus {
    const allowed = InvoiceStatus.TRANSITIONS[this.props.value];
    if (!allowed.includes(next)) {
      throw new BusinessRuleError(`Fatura ${this.props.value} nao pode ir para ${next}`, {
        from: this.props.value,
        to: next,
        allowed,
      });
    }
    return new InvoiceStatus(next);
  }
}

export class PlanCode extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }
  static create(raw: string): PlanCode {
    const normalized = Guard.notBlank(raw, "code").toLowerCase();
    Guard.matches(normalized, /^[a-z][a-z0-9_]{1,30}$/, "code", "minusculas, numeros, sublinhado");
    return new PlanCode(normalized);
  }
  get value(): string {
    return this.props.value;
  }
  override toString(): string {
    return this.props.value;
  }
}

export interface UsageSnapshot {
  users: number;
  projects: number;
  deals: number;
  contacts: number;
}

export interface LimitViolation {
  resource: string;
  limit: number;
  current: number;
}

/**
 * Limites do plano. Ausencia de valor, ou nulo, significa ilimitado, que e
 * como o plano Enterprise e descrito.
 */
export class PlanLimits extends ValueObject<{
  users: number | null;
  projects: number | null;
  deals: number | null;
  contacts: number | null;
}> {
  private constructor(props: {
    users: number | null;
    projects: number | null;
    deals: number | null;
    contacts: number | null;
  }) {
    super(props);
  }

  static fromJson(raw: Record<string, unknown> | null): PlanLimits {
    const read = (key: string): number | null => {
      const value = raw?.[key];
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    };
    return new PlanLimits({
      users: read("users"),
      projects: read("projects"),
      deals: read("deals"),
      contacts: read("contacts"),
    });
  }

  get users(): number | null {
    return this.props.users;
  }
  get projects(): number | null {
    return this.props.projects;
  }
  get deals(): number | null {
    return this.props.deals;
  }
  get contacts(): number | null {
    return this.props.contacts;
  }

  limitFor(resource: keyof UsageSnapshot): number | null {
    return this.props[resource];
  }

  /** Recursos em que o consumo atual ja passou do que o plano permite. */
  violationsFor(usage: UsageSnapshot): LimitViolation[] {
    const resources: (keyof UsageSnapshot)[] = ["users", "projects", "deals", "contacts"];
    const violations: LimitViolation[] = [];
    for (const resource of resources) {
      const limit = this.limitFor(resource);
      if (limit !== null && usage[resource] > limit) {
        violations.push({ resource, limit, current: usage[resource] });
      }
    }
    return violations;
  }

  override toJSON() {
    return this.props;
  }
}

/** Metrica de consumo medido, no formato usado pelo banco. */
export class UsageMetric extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }
  static create(raw: string): UsageMetric {
    const normalized = Guard.notBlank(raw, "metric").toLowerCase();
    Guard.matches(normalized, /^[a-z][a-z0-9_.]{1,40}$/, "metric", "minusculas, ponto, sublinhado");
    return new UsageMetric(normalized);
  }
  get value(): string {
    return this.props.value;
  }
  override toString(): string {
    return this.props.value;
  }
}

/** Resultado do rateio ao trocar de plano no meio do periodo. */
export class Proration extends ValueObject<{
  creditCents: number;
  chargeCents: number;
  currency: string;
  remainingRatio: number;
}> {
  private constructor(props: {
    creditCents: number;
    chargeCents: number;
    currency: string;
    remainingRatio: number;
  }) {
    super(props);
  }

  static between(current: Money, next: Money, remainingRatio: number): Proration {
    const credit = current.prorate(remainingRatio);
    const charge = next.prorate(remainingRatio);
    return new Proration({
      creditCents: credit.cents,
      chargeCents: charge.cents,
      currency: next.currency,
      remainingRatio: Math.round(remainingRatio * 10_000) / 10_000,
    });
  }

  get credit(): Money {
    return Money.fromCents(this.props.creditCents, this.props.currency);
  }
  get charge(): Money {
    return Money.fromCents(this.props.chargeCents, this.props.currency);
  }
  /** Positivo, o tenant paga a diferenca; negativo, fica com credito. */
  get difference(): Money {
    return this.charge.subtract(this.credit);
  }
  get remainingRatio(): number {
    return this.props.remainingRatio;
  }
}
