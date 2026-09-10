import { V } from "../../_shared/mod.ts";
import type { Invoice, InvoiceLine, Plan, Subscription } from "../domain/entities.ts";
import type { LimitCheck } from "../domain/services.ts";
import type { UsageTotal } from "../domain/ports.ts";
import type { Proration } from "../domain/value-objects.ts";

export const SubscribeSchema = V.schema({
  planCode: V.string().lower().matching(/^[a-z][a-z0-9_]{1,30}$/, "codigo de plano"),
});

export const ChangePlanSchema = V.schema({
  planCode: V.string().lower().matching(/^[a-z][a-z0-9_]{1,30}$/, "codigo de plano"),
});

export const CancelSubscriptionSchema = V.schema({
  atPeriodEnd: V.boolean().default(true),
});

export const RecordUsageSchema = V.schema({
  metric: V.string().lower().matching(/^[a-z][a-z0-9_.]{1,40}$/, "metrica"),
  quantity: V.number().min(0.0001),
  recordedAt: V.date().optional(),
  idempotencyKey: V.string().max(120).optional(),
  metadata: V.record().optional(),
});

export const IssueInvoiceSchema = V.schema({
  dueInDays: V.integer().min(0).max(90).default(15),
  taxCents: V.cents().default(0),
  includeUsage: V.boolean().default(true),
});

export const IdSchema = V.schema({ id: V.uuid() });

export class PlanPresenter {
  static toDto(plan: Plan): Record<string, unknown> {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      priceCents: plan.price.cents,
      currency: plan.price.currency,
      priceFormatted: plan.price.format(),
      interval: plan.interval,
      trialDays: plan.trialDays,
      features: plan.features,
      limits: plan.limits.toJSON(),
      isActive: plan.isActive,
      position: plan.position,
    };
  }
}

export class SubscriptionPresenter {
  static toDto(subscription: Subscription, now: Date): Record<string, unknown> {
    return {
      id: subscription.id,
      tenantId: subscription.tenantId,
      planId: subscription.planId,
      planCode: subscription.planCode,
      planPriceCents: subscription.planPrice.cents,
      currency: subscription.planPrice.currency,
      status: subscription.status.value,
      currentPeriodStart: subscription.period.start.toISOString(),
      currentPeriodEnd: subscription.period.end.toISOString(),
      remainingRatio: Math.round(subscription.period.remainingRatio(now) * 10_000) / 10_000,
      trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
      isTrialing: subscription.isTrialing(now),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
      createdAt: subscription.createdAt.toISOString(),
      updatedAt: subscription.updatedAt.toISOString(),
    };
  }

  static prorationToDto(proration: Proration): Record<string, unknown> {
    return {
      creditCents: proration.credit.cents,
      chargeCents: proration.charge.cents,
      differenceCents: proration.difference.cents,
      differenceFormatted: proration.difference.format(),
      remainingRatio: proration.remainingRatio,
    };
  }

  static limitsToDto(check: LimitCheck): Record<string, unknown> {
    return {
      plan: check.plan,
      usage: check.usage,
      limits: check.limits,
      violations: check.violations,
      withinLimits: check.withinLimits,
    };
  }
}

export class InvoiceLinePresenter {
  static toDto(line: InvoiceLine): Record<string, unknown> {
    return {
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitCents: line.unitAmount.cents,
      totalCents: line.total.cents,
      totalFormatted: line.total.format(),
      position: line.position,
      metadata: line.metadata,
    };
  }
}

export class InvoicePresenter {
  static toDto(invoice: Invoice, includeLines = true): Record<string, unknown> {
    const dto: Record<string, unknown> = {
      id: invoice.id,
      tenantId: invoice.tenantId,
      subscriptionId: invoice.subscriptionId,
      number: invoice.number,
      status: invoice.status.value,
      currency: invoice.currency,
      subtotalCents: invoice.subtotal.cents,
      taxCents: invoice.tax.cents,
      totalCents: invoice.total.cents,
      totalFormatted: invoice.total.format(),
      periodStart: invoice.period.start.toISOString(),
      periodEnd: invoice.period.end.toISOString(),
      issuedAt: invoice.issuedAt?.toISOString() ?? null,
      dueAt: invoice.dueAt?.toISOString() ?? null,
      paidAt: invoice.paidAt?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
    };
    if (includeLines) {
      dto.lines = invoice.lines.map((line) => InvoiceLinePresenter.toDto(line));
    }
    return dto;
  }
}

export class UsagePresenter {
  static toDto(totals: readonly UsageTotal[], from: Date, to: Date): Record<string, unknown> {
    return {
      periodStart: from.toISOString(),
      periodEnd: to.toISOString(),
      metrics: totals.map((total) => ({ ...total })),
    };
  }
}
