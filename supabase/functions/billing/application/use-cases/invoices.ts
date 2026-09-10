import {
  BaseUseCase,
  type AuditTrail,
  type Clock,
  type EventPublisher,
  type IdGenerator,
  type Page,
  type PageRequest,
  type RequestContext,
} from "../../../_shared/mod.ts";
import { Invoice } from "../../domain/entities.ts";
import type {
  InvoiceFilter,
  InvoiceRepository,
  PlanRepository,
  SubscriptionRepository,
  UsageRepository,
} from "../../domain/ports.ts";
import { InvoicePresenter } from "../dto.ts";

export interface IssueInvoiceInput {
  dueInDays: number;
  taxCents: number;
  includeUsage: boolean;
}

/**
 * Emite a fatura do periodo corrente: uma linha para a assinatura e, se
 * pedido, uma linha por metrica de consumo medida no periodo.
 */
export class IssueInvoiceUseCase extends BaseUseCase<IssueInvoiceInput, Record<string, unknown>> {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly subscriptions: SubscriptionRepository,
    private readonly plans: PlanRepository,
    private readonly usage: UsageRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "billing.invoice.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: IssueInvoiceInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();
    const now = this.clock.now();

    const subscription = await this.subscriptions.getLive(tenantId);
    subscription.ensureInvoiceable();
    const plan = await this.plans.getById(subscription.planId);

    const invoice = Invoice.draft({
      id: this.ids.generate(),
      tenantId,
      subscriptionId: subscription.id,
      number: await this.invoices.nextNumber(tenantId),
      currency: subscription.planPrice.currency,
      period: subscription.period,
      createdBy: ctx.requireUserId(),
      now,
    });

    invoice.addLine({
      id: this.ids.generate(),
      description: `Assinatura ${plan.name} (${plan.interval === "year" ? "anual" : "mensal"})`,
      quantity: 1,
      unitAmountCents: subscription.planPrice.cents,
      metadata: { planCode: plan.code },
    });

    if (input.includeUsage) {
      const totals = await this.usage.totals(
        tenantId,
        subscription.period.start,
        subscription.period.end,
      );
      for (const total of totals) {
        invoice.addLine({
          id: this.ids.generate(),
          description: `Consumo: ${total.metric}`,
          quantity: total.quantity,
          unitAmountCents: 0,
          metadata: { metric: total.metric, events: total.events },
        });
      }
    }

    if (input.taxCents > 0) invoice.applyTax(input.taxCents);
    invoice.issue(input.dueInDays, now);

    const saved = await this.invoices.insert(invoice);
    await this.events.publish(invoice.pullEvents());
    await this.audit.record({
      action: "invoice.issued",
      resourceType: "invoice",
      resourceId: saved.id,
      metadata: { number: saved.number, totalCents: saved.total.cents },
    });
    return InvoicePresenter.toDto(saved);
  }
}

export class ListInvoicesUseCase
  extends BaseUseCase<{ filter: InvoiceFilter; page: PageRequest }, Record<string, unknown>> {
  constructor(private readonly invoices: InvoiceRepository) {
    super();
  }
  protected override get permission(): string | null {
    return "billing.invoice.read";
  }
  protected override async handle(
    input: { filter: InvoiceFilter; page: PageRequest },
  ): Promise<Record<string, unknown>> {
    const result: Page<unknown> = (await this.invoices.search(input.filter, input.page))
      .map((invoice) => InvoicePresenter.toDto(invoice, false));
    return result.toJSON();
  }
}

export class GetInvoiceUseCase extends BaseUseCase<{ id: string }, Record<string, unknown>> {
  constructor(private readonly invoices: InvoiceRepository) {
    super();
  }
  protected override get permission(): string | null {
    return "billing.invoice.read";
  }
  protected override async handle(input: { id: string }): Promise<Record<string, unknown>> {
    return InvoicePresenter.toDto(await this.invoices.getById(input.id, true));
  }
}

export class PayInvoiceUseCase extends BaseUseCase<{ id: string }, Record<string, unknown>> {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }
  protected override get permission(): string | null {
    return "billing.invoice.write";
  }
  protected override get mutating(): boolean {
    return true;
  }
  protected override async handle(input: { id: string }): Promise<Record<string, unknown>> {
    const invoice = await this.invoices.getById(input.id, true);
    invoice.markPaid(this.clock.now());
    const saved = await this.invoices.save(invoice);

    await this.events.publish(invoice.pullEvents());
    await this.audit.record({
      action: "invoice.paid",
      resourceType: "invoice",
      resourceId: saved.id,
      metadata: { number: saved.number, totalCents: saved.total.cents },
    });
    return InvoicePresenter.toDto(saved);
  }
}

export class VoidInvoiceUseCase extends BaseUseCase<{ id: string }, Record<string, unknown>> {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly clock: Clock,
    private readonly audit: AuditTrail,
  ) {
    super();
  }
  protected override get permission(): string | null {
    return "billing.invoice.write";
  }
  protected override get mutating(): boolean {
    return true;
  }
  protected override async handle(input: { id: string }): Promise<Record<string, unknown>> {
    const invoice = await this.invoices.getById(input.id, true);
    invoice.cancelInvoice(this.clock.now());
    const saved = await this.invoices.save(invoice);
    await this.audit.record({
      action: "invoice.void",
      resourceType: "invoice",
      resourceId: saved.id,
      metadata: { number: saved.number },
    });
    return InvoicePresenter.toDto(saved);
  }
}
