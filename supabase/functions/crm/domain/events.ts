import { DomainEvent } from "../../_shared/mod.ts";

export class CompanyCreated extends DomainEvent {
  constructor(tenantId: string, companyId: string, readonly companyName: string) {
    super(tenantId, companyId);
  }
  override get name(): string {
    return "crm.company.created";
  }
  override get aggregateType(): string {
    return "Company";
  }
  override payload(): Record<string, unknown> {
    return { name: this.companyName };
  }
}

export class ContactCreated extends DomainEvent {
  constructor(tenantId: string, contactId: string, readonly email: string | null) {
    super(tenantId, contactId);
  }
  override get name(): string {
    return "crm.contact.created";
  }
  override get aggregateType(): string {
    return "Contact";
  }
  override payload(): Record<string, unknown> {
    return { email: this.email };
  }
}

export class DealCreated extends DomainEvent {
  constructor(
    tenantId: string,
    dealId: string,
    readonly title: string,
    readonly amountCents: number,
    readonly currency: string,
  ) {
    super(tenantId, dealId);
  }
  override get name(): string {
    return "crm.deal.created";
  }
  override get aggregateType(): string {
    return "Deal";
  }
  override payload(): Record<string, unknown> {
    return { title: this.title, amountCents: this.amountCents, currency: this.currency };
  }
}

export class DealStageChanged extends DomainEvent {
  constructor(
    tenantId: string,
    dealId: string,
    readonly from: string,
    readonly to: string,
    readonly probability: number,
  ) {
    super(tenantId, dealId);
  }
  override get name(): string {
    return "crm.deal.stage_changed";
  }
  override get aggregateType(): string {
    return "Deal";
  }
  override payload(): Record<string, unknown> {
    return { from: this.from, to: this.to, probability: this.probability };
  }
}

export class DealClosed extends DomainEvent {
  constructor(
    tenantId: string,
    dealId: string,
    readonly outcome: "won" | "lost",
    readonly amountCents: number,
    readonly reason: string | null,
  ) {
    super(tenantId, dealId);
  }
  override get name(): string {
    return `crm.deal.${this.outcome}`;
  }
  override get aggregateType(): string {
    return "Deal";
  }
  override payload(): Record<string, unknown> {
    return { outcome: this.outcome, amountCents: this.amountCents, reason: this.reason };
  }
}

export class ActivityLogged extends DomainEvent {
  constructor(
    tenantId: string,
    dealId: string,
    readonly activityId: string,
    readonly kind: string,
  ) {
    super(tenantId, dealId);
  }
  override get name(): string {
    return "crm.activity.logged";
  }
  override get aggregateType(): string {
    return "Deal";
  }
  override payload(): Record<string, unknown> {
    return { activityId: this.activityId, kind: this.kind };
  }
}
