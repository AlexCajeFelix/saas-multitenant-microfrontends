import { DateRange, Mapper, Money } from "../../../_shared/mod.ts";
import { Invoice, InvoiceLine, Plan, Subscription } from "../../domain/entities.ts";
import {
  InvoiceStatus,
  PlanCode,
  PlanLimits,
  SubscriptionStatus,
} from "../../domain/value-objects.ts";

export interface PlanRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  interval: string;
  trial_days: number;
  features: unknown;
  limits: Record<string, unknown> | null;
  is_active: boolean;
  position: number;
}

export class PlanMapper extends Mapper<Plan, PlanRow> {
  override toDomain(row: PlanRow): Plan {
    return Plan.restore(row.id, {
      code: PlanCode.create(row.code),
      name: row.name,
      description: row.description ?? "",
      price: Money.fromCents(Number(row.price_cents), row.currency),
      interval: row.interval === "year" ? "year" : "month",
      trialDays: row.trial_days,
      features: Array.isArray(row.features) ? (row.features as string[]) : [],
      limits: PlanLimits.fromJson(row.limits),
      isActive: row.is_active,
      position: row.position,
    });
  }

  override toRow(plan: Plan): Record<string, unknown> {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      price_cents: plan.price.cents,
      currency: plan.price.currency,
      interval: plan.interval,
      trial_days: plan.trialDays,
      features: plan.features,
      limits: plan.limits.toJSON(),
      is_active: plan.isActive,
      position: plan.position,
    };
  }
}

export interface SubscriptionRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  plan?: PlanRow | null;
}

export class SubscriptionMapper extends Mapper<Subscription, SubscriptionRow> {
  override toDomain(row: SubscriptionRow): Subscription {
    const plan = row.plan;
    return Subscription.restore(row.id, {
      tenantId: row.tenant_id,
      planId: row.plan_id,
      planCode: plan ? plan.code : "",
      planPrice: plan
        ? Money.fromCents(Number(plan.price_cents), plan.currency)
        : Money.zero("BRL"),
      status: SubscriptionStatus.create(row.status),
      period: DateRange.create(
        new Date(row.current_period_start),
        new Date(row.current_period_end),
      ),
      trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : null,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  override toRow(subscription: Subscription): Record<string, unknown> {
    return {
      id: subscription.id,
      tenant_id: subscription.tenantId,
      plan_id: subscription.planId,
      status: subscription.status.value,
      current_period_start: subscription.period.start.toISOString(),
      current_period_end: subscription.period.end.toISOString(),
      trial_ends_at: subscription.trialEndsAt?.toISOString() ?? null,
      cancel_at_period_end: subscription.cancelAtPeriodEnd,
      cancelled_at: subscription.cancelledAt?.toISOString() ?? null,
      created_by: subscription.createdBy,
    };
  }
}

export interface InvoiceLineRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_cents: number;
  total_cents: number;
  metadata: Record<string, unknown> | null;
  position: number;
}

export class InvoiceLineMapper extends Mapper<InvoiceLine, InvoiceLineRow> {
  constructor(private readonly currency: string) {
    super();
  }

  override toDomain(row: InvoiceLineRow): InvoiceLine {
    return InvoiceLine.restore(row.id, {
      tenantId: row.tenant_id,
      invoiceId: row.invoice_id,
      description: row.description,
      quantity: Number(row.quantity),
      unitAmount: Money.fromCents(Number(row.unit_cents), this.currency),
      position: row.position,
      metadata: row.metadata ?? {},
    });
  }

  override toRow(line: InvoiceLine): Record<string, unknown> {
    return {
      id: line.id,
      tenant_id: line.tenantId,
      invoice_id: line.invoiceId,
      description: line.description,
      quantity: line.quantity,
      unit_cents: line.unitAmount.cents,
      total_cents: line.total.cents,
      metadata: line.metadata,
      position: line.position,
    };
  }
}

export interface InvoiceRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  subscription_id: string | null;
  number: string;
  status: string;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  period_start: string;
  period_end: string;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  invoice_lines?: InvoiceLineRow[] | null;
}

export class InvoiceMapper extends Mapper<Invoice, InvoiceRow> {
  override toDomain(row: InvoiceRow): Invoice {
    const lineMapper = new InvoiceLineMapper(row.currency);
    return Invoice.restore(row.id, {
      tenantId: row.tenant_id,
      subscriptionId: row.subscription_id,
      number: row.number,
      status: InvoiceStatus.create(row.status),
      currency: row.currency,
      period: DateRange.create(new Date(row.period_start), new Date(row.period_end)),
      taxCents: Number(row.tax_cents),
      issuedAt: row.issued_at ? new Date(row.issued_at) : null,
      dueAt: row.due_at ? new Date(row.due_at) : null,
      paidAt: row.paid_at ? new Date(row.paid_at) : null,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lines: lineMapper.toDomainList(row.invoice_lines ?? []),
    });
  }

  /** Os totais sao derivados do agregado, nunca aceitos de fora. */
  override toRow(invoice: Invoice): Record<string, unknown> {
    return {
      id: invoice.id,
      tenant_id: invoice.tenantId,
      subscription_id: invoice.subscriptionId,
      number: invoice.number,
      status: invoice.status.value,
      currency: invoice.currency,
      subtotal_cents: invoice.subtotal.cents,
      tax_cents: invoice.tax.cents,
      total_cents: invoice.total.cents,
      period_start: invoice.period.start.toISOString(),
      period_end: invoice.period.end.toISOString(),
      issued_at: invoice.issuedAt?.toISOString() ?? null,
      due_at: invoice.dueAt?.toISOString() ?? null,
      paid_at: invoice.paidAt?.toISOString() ?? null,
      created_by: invoice.createdBy,
    };
  }
}
