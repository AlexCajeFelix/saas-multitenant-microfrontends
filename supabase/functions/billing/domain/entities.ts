import {
  AggregateRoot,
  BusinessRuleError,
  DateRange,
  Entity,
  Guard,
  Money,
} from "../../_shared/mod.ts";
import {
  InvoiceIssued,
  InvoicePaid,
  PlanChanged,
  SubscriptionCancelled,
  SubscriptionStarted,
} from "./events.ts";
import {
  InvoiceStatus,
  type InvoiceStatusValue,
  PlanCode,
  PlanLimits,
  Proration,
  SubscriptionStatus,
  type SubscriptionStatusValue,
} from "./value-objects.ts";

interface PlanProps extends Record<string, unknown> {
  code: PlanCode;
  name: string;
  description: string;
  price: Money;
  interval: "month" | "year";
  trialDays: number;
  features: string[];
  limits: PlanLimits;
  isActive: boolean;
  position: number;
}

/**
 * Plano do catalogo global. Nao pertence a tenant algum e nao e alterado pela
 * API: e uma entidade de leitura, mas com comportamento proprio.
 */
export class Plan extends Entity<PlanProps> {
  private constructor(id: string, props: PlanProps) {
    super(id, props);
  }

  static restore(id: string, props: PlanProps): Plan {
    return new Plan(id, props);
  }

  get code(): string {
    return this.props.code.value;
  }
  get name(): string {
    return this.props.name;
  }
  get description(): string {
    return this.props.description;
  }
  get price(): Money {
    return this.props.price;
  }
  get interval(): "month" | "year" {
    return this.props.interval;
  }
  get trialDays(): number {
    return this.props.trialDays;
  }
  get features(): string[] {
    return [...this.props.features];
  }
  get limits(): PlanLimits {
    return this.props.limits;
  }
  get isActive(): boolean {
    return this.props.isActive;
  }
  get position(): number {
    return this.props.position;
  }
  get isFree(): boolean {
    return this.props.price.isZero;
  }

  /** Periodo de cobranca a partir de uma data, conforme o intervalo do plano. */
  periodFrom(start: Date): DateRange {
    return this.props.interval === "year"
      ? DateRange.yearFrom(start)
      : DateRange.monthFrom(start);
  }

  ensureSubscribable(): void {
    if (!this.props.isActive) {
      throw new BusinessRuleError(`O plano ${this.code} nao esta mais disponivel`, {
        planCode: this.code,
      });
    }
  }
}

interface SubscriptionProps extends Record<string, unknown> {
  tenantId: string;
  planId: string;
  planCode: string;
  planPrice: Money;
  status: SubscriptionStatus;
  period: DateRange;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Assinatura do tenant. Ha no maximo uma vigente por vez, garantido tambem por
 * indice unico parcial no banco.
 */
export class Subscription extends AggregateRoot<SubscriptionProps> {
  private lastProration: Proration | null = null;

  private constructor(id: string, props: SubscriptionProps) {
    super(id, props);
  }

  static start(input: {
    id: string;
    tenantId: string;
    plan: Plan;
    createdBy: string;
    now: Date;
  }): Subscription {
    input.plan.ensureSubscribable();

    const period = input.plan.periodFrom(input.now);
    const trialEndsAt = input.plan.trialDays > 0
      ? new Date(input.now.getTime() + input.plan.trialDays * 86_400_000)
      : null;

    const subscription = new Subscription(input.id, {
      tenantId: input.tenantId,
      planId: input.plan.id,
      planCode: input.plan.code,
      planPrice: input.plan.price,
      status: SubscriptionStatus.of(trialEndsAt ? "trialing" : "active"),
      period,
      trialEndsAt,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
    });
    subscription.record(new SubscriptionStarted(input.tenantId, input.id, input.plan.code));
    return subscription;
  }

  static restore(id: string, props: SubscriptionProps): Subscription {
    return new Subscription(id, props);
  }

  override get tenantId(): string {
    return this.props.tenantId;
  }
  get planId(): string {
    return this.props.planId;
  }
  get planCode(): string {
    return this.props.planCode;
  }
  get planPrice(): Money {
    return this.props.planPrice;
  }
  get status(): SubscriptionStatus {
    return this.props.status;
  }
  get period(): DateRange {
    return this.props.period;
  }
  get trialEndsAt(): Date | null {
    return this.props.trialEndsAt;
  }
  get cancelAtPeriodEnd(): boolean {
    return this.props.cancelAtPeriodEnd;
  }
  get cancelledAt(): Date | null {
    return this.props.cancelledAt;
  }
  get createdBy(): string | null {
    return this.props.createdBy;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
  get proration(): Proration | null {
    return this.lastProration;
  }

  isTrialing(now: Date): boolean {
    return this.props.trialEndsAt !== null && this.props.trialEndsAt.getTime() > now.getTime();
  }

  /**
   * Troca de plano no meio do periodo. O que sobrou do plano antigo vira
   * credito e o novo e cobrado pela mesma fracao restante; a diferenca e o que
   * de fato se cobra.
   */
  changePlan(plan: Plan, now: Date): Proration {
    plan.ensureSubscribable();
    if (this.props.status.isCancelled) {
      throw new BusinessRuleError("Assinatura cancelada nao troca de plano");
    }
    if (plan.id === this.props.planId) {
      throw new BusinessRuleError("A assinatura ja esta neste plano", { planCode: plan.code });
    }

    const proration = Proration.between(
      this.props.planPrice,
      plan.price,
      this.props.period.remainingRatio(now),
    );

    const previousCode = this.props.planCode;
    this.props.planId = plan.id;
    this.props.planCode = plan.code;
    this.props.planPrice = plan.price;
    this.props.status = this.props.status.value === "trialing"
      ? this.props.status
      : this.props.status.transitionTo("active");
    this.props.updatedAt = now;
    this.lastProration = proration;

    this.record(
      new PlanChanged(
        this.tenantId,
        this._id,
        previousCode,
        plan.code,
        proration.difference.cents,
      ),
    );
    return proration;
  }

  cancel(atPeriodEnd: boolean, now: Date): void {
    if (this.props.status.isCancelled) {
      throw new BusinessRuleError("Esta assinatura ja foi cancelada");
    }
    if (atPeriodEnd) {
      this.props.cancelAtPeriodEnd = true;
    } else {
      this.props.status = this.props.status.transitionTo("cancelled");
      this.props.cancelledAt = now;
    }
    this.props.updatedAt = now;
    this.record(new SubscriptionCancelled(this.tenantId, this._id, atPeriodEnd));
  }

  renew(plan: Plan, now: Date): void {
    if (this.props.cancelAtPeriodEnd) {
      this.props.status = this.props.status.transitionTo("cancelled");
      this.props.cancelledAt = now;
    } else {
      this.props.period = plan.periodFrom(this.props.period.end);
      this.props.status = this.props.status.transitionTo("active");
    }
    this.props.updatedAt = now;
  }

  /** Faturar exige assinatura viva: cancelada nao gera cobranca nova. */
  ensureInvoiceable(): void {
    if (this.props.status.isCancelled) {
      throw new BusinessRuleError("Assinatura cancelada nao gera faturas", {
        subscriptionId: this._id,
      });
    }
  }
}

interface InvoiceLineProps extends Record<string, unknown> {
  tenantId: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitAmount: Money;
  position: number;
  metadata: Record<string, unknown>;
}

/** Entidade filha do agregado Invoice. */
export class InvoiceLine extends Entity<InvoiceLineProps> {
  private constructor(id: string, props: InvoiceLineProps) {
    super(id, props);
  }

  static create(input: {
    id: string;
    tenantId: string;
    invoiceId: string;
    description: string;
    quantity: number;
    unitAmount: Money;
    position: number;
    metadata?: Record<string, unknown>;
  }): InvoiceLine {
    Guard.rule(input.quantity > 0, "A quantidade da linha deve ser positiva");
    return new InvoiceLine(input.id, {
      tenantId: input.tenantId,
      invoiceId: input.invoiceId,
      description: Guard.length(input.description, "description", 1, 240),
      quantity: input.quantity,
      unitAmount: input.unitAmount,
      position: input.position,
      metadata: input.metadata ?? {},
    });
  }

  static restore(id: string, props: InvoiceLineProps): InvoiceLine {
    return new InvoiceLine(id, props);
  }

  get tenantId(): string {
    return this.props.tenantId;
  }
  get invoiceId(): string {
    return this.props.invoiceId;
  }
  get description(): string {
    return this.props.description;
  }
  get quantity(): number {
    return this.props.quantity;
  }
  get unitAmount(): Money {
    return this.props.unitAmount;
  }
  get position(): number {
    return this.props.position;
  }
  get metadata(): Record<string, unknown> {
    return this.props.metadata;
  }
  get total(): Money {
    return this.props.unitAmount.multiply(this.props.quantity);
  }
}

interface InvoiceProps extends Record<string, unknown> {
  tenantId: string;
  subscriptionId: string | null;
  number: string;
  status: InvoiceStatus;
  currency: string;
  period: DateRange;
  taxCents: number;
  issuedAt: Date | null;
  dueAt: Date | null;
  paidAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  lines: InvoiceLine[];
}

/**
 * Fatura. Os totais sao sempre derivados das linhas, nunca informados; fatura
 * paga ou cancelada e imutavel.
 */
export class Invoice extends AggregateRoot<InvoiceProps> {
  private newLines: InvoiceLine[] = [];

  private constructor(id: string, props: InvoiceProps) {
    super(id, props);
  }

  static draft(input: {
    id: string;
    tenantId: string;
    subscriptionId: string | null;
    number: string;
    currency: string;
    period: DateRange;
    createdBy: string;
    now: Date;
  }): Invoice {
    return new Invoice(input.id, {
      tenantId: input.tenantId,
      subscriptionId: input.subscriptionId,
      number: Guard.notBlank(input.number, "number"),
      status: InvoiceStatus.draft(),
      currency: input.currency,
      period: input.period,
      taxCents: 0,
      issuedAt: null,
      dueAt: null,
      paidAt: null,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
      lines: [],
    });
  }

  static restore(id: string, props: InvoiceProps): Invoice {
    return new Invoice(id, props);
  }

  override get tenantId(): string {
    return this.props.tenantId;
  }
  get subscriptionId(): string | null {
    return this.props.subscriptionId;
  }
  get number(): string {
    return this.props.number;
  }
  get status(): InvoiceStatus {
    return this.props.status;
  }
  get currency(): string {
    return this.props.currency;
  }
  get period(): DateRange {
    return this.props.period;
  }
  get issuedAt(): Date | null {
    return this.props.issuedAt;
  }
  get dueAt(): Date | null {
    return this.props.dueAt;
  }
  get paidAt(): Date | null {
    return this.props.paidAt;
  }
  get createdBy(): string | null {
    return this.props.createdBy;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
  get lines(): readonly InvoiceLine[] {
    return this.props.lines;
  }

  get subtotal(): Money {
    return this.props.lines.reduce(
      (sum, line) => sum.add(line.total),
      Money.zero(this.props.currency),
    );
  }
  get tax(): Money {
    return Money.fromCents(this.props.taxCents, this.props.currency);
  }
  get total(): Money {
    return this.subtotal.add(this.tax);
  }

  private assertEditable(): void {
    if (!this.props.status.isDraft) {
      throw new BusinessRuleError(`Fatura ${this.props.status.value} nao pode ser alterada`, {
        invoiceId: this._id,
        status: this.props.status.value,
      });
    }
  }

  addLine(input: {
    id: string;
    description: string;
    quantity: number;
    unitAmountCents: number;
    metadata?: Record<string, unknown>;
  }): InvoiceLine {
    this.assertEditable();
    const line = InvoiceLine.create({
      id: input.id,
      tenantId: this.tenantId,
      invoiceId: this._id,
      description: input.description,
      quantity: input.quantity,
      unitAmount: Money.fromCents(input.unitAmountCents, this.props.currency),
      position: this.props.lines.length + 1,
      metadata: input.metadata,
    });
    this.props.lines = [...this.props.lines, line];
    this.newLines.push(line);
    return line;
  }

  applyTax(taxCents: number): void {
    this.assertEditable();
    this.props.taxCents = Guard.nonNegative(Guard.integer(taxCents, "taxCents"), "taxCents");
  }

  /** Fecha a fatura para edicao e a coloca em aberto para pagamento. */
  issue(dueInDays: number, now: Date): void {
    if (this.props.lines.length === 0) {
      throw new BusinessRuleError("Nao se emite fatura sem nenhuma linha");
    }
    this.props.status = this.props.status.transitionTo("open");
    this.props.issuedAt = now;
    this.props.dueAt = new Date(now.getTime() + Guard.range(dueInDays, "dueInDays", 0, 90) * 86_400_000);
    this.props.updatedAt = now;
    this.record(new InvoiceIssued(this.tenantId, this._id, this.props.number, this.total.cents));
  }

  markPaid(now: Date): void {
    this.props.status = this.props.status.transitionTo("paid");
    this.props.paidAt = now;
    this.props.updatedAt = now;
    this.record(new InvoicePaid(this.tenantId, this._id, this.total.cents));
  }

  cancelInvoice(now: Date): void {
    this.props.status = this.props.status.transitionTo("void");
    this.props.updatedAt = now;
  }

  changeStatus(next: InvoiceStatusValue, now: Date): void {
    if (next === "paid") this.markPaid(now);
    else if (next === "void") this.cancelInvoice(now);
    else if (next === "open") this.issue(15, now);
    else throw new BusinessRuleError(`Transicao para ${next} nao suportada`);
  }

  pullNewLines(): InvoiceLine[] {
    const pending = this.newLines;
    this.newLines = [];
    return pending;
  }
}

export type { SubscriptionStatusValue };
