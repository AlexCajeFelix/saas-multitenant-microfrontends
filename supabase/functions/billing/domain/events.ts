import { DomainEvent } from "../../_shared/mod.ts";

export class SubscriptionStarted extends DomainEvent {
  constructor(tenantId: string, subscriptionId: string, readonly planCode: string) {
    super(tenantId, subscriptionId);
  }
  override get name(): string {
    return "billing.subscription.started";
  }
  override get aggregateType(): string {
    return "Subscription";
  }
  override payload(): Record<string, unknown> {
    return { planCode: this.planCode };
  }
}

export class PlanChanged extends DomainEvent {
  constructor(
    tenantId: string,
    subscriptionId: string,
    readonly fromPlan: string,
    readonly toPlan: string,
    readonly differenceCents: number,
  ) {
    super(tenantId, subscriptionId);
  }
  override get name(): string {
    return "billing.subscription.plan_changed";
  }
  override get aggregateType(): string {
    return "Subscription";
  }
  override payload(): Record<string, unknown> {
    return {
      fromPlan: this.fromPlan,
      toPlan: this.toPlan,
      differenceCents: this.differenceCents,
    };
  }
}

export class SubscriptionCancelled extends DomainEvent {
  constructor(tenantId: string, subscriptionId: string, readonly atPeriodEnd: boolean) {
    super(tenantId, subscriptionId);
  }
  override get name(): string {
    return "billing.subscription.cancelled";
  }
  override get aggregateType(): string {
    return "Subscription";
  }
  override payload(): Record<string, unknown> {
    return { atPeriodEnd: this.atPeriodEnd };
  }
}

export class UsageRecorded extends DomainEvent {
  constructor(
    tenantId: string,
    usageId: string,
    readonly metric: string,
    readonly quantity: number,
  ) {
    super(tenantId, usageId);
  }
  override get name(): string {
    return "billing.usage.recorded";
  }
  override get aggregateType(): string {
    return "UsageRecord";
  }
  override payload(): Record<string, unknown> {
    return { metric: this.metric, quantity: this.quantity };
  }
}

export class InvoiceIssued extends DomainEvent {
  constructor(
    tenantId: string,
    invoiceId: string,
    readonly number: string,
    readonly totalCents: number,
  ) {
    super(tenantId, invoiceId);
  }
  override get name(): string {
    return "billing.invoice.issued";
  }
  override get aggregateType(): string {
    return "Invoice";
  }
  override payload(): Record<string, unknown> {
    return { number: this.number, totalCents: this.totalCents };
  }
}

export class InvoicePaid extends DomainEvent {
  constructor(tenantId: string, invoiceId: string, readonly totalCents: number) {
    super(tenantId, invoiceId);
  }
  override get name(): string {
    return "billing.invoice.paid";
  }
  override get aggregateType(): string {
    return "Invoice";
  }
  override payload(): Record<string, unknown> {
    return { totalCents: this.totalCents };
  }
}
