import {
  type AuditTrail,
  BaseUseCase,
  type Clock,
  ConflictError,
  type EventPublisher,
  type IdGenerator,
  type RequestContext,
} from "../../../_shared/mod.ts";
import { Subscription } from "../../domain/entities.ts";
import type {
  PlanRepository,
  SubscriptionRepository,
  UsageRepository,
} from "../../domain/ports.ts";
import type { PlanLimitPolicy } from "../../domain/services.ts";
import { PlanPresenter, SubscriptionPresenter, UsagePresenter } from "../dto.ts";
import { UsageRecorded } from "../../domain/events.ts";

export class ListPlansUseCase extends BaseUseCase<void, Record<string, unknown>[]> {
  constructor(private readonly plans: PlanRepository) {
    super();
  }
  protected override get permission(): string | null {
    return "billing.plan.read";
  }
  protected override async handle(): Promise<Record<string, unknown>[]> {
    const plans = await this.plans.listActive();
    return plans.map((plan) => PlanPresenter.toDto(plan));
  }
}

export class SubscribeUseCase extends BaseUseCase<{ planCode: string }, Record<string, unknown>> {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly plans: PlanRepository,
    private readonly policy: PlanLimitPolicy,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "billing.subscription.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: { planCode: string },
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();

    if (await this.subscriptions.findLive(tenantId)) {
      throw new ConflictError(
        "Este tenant ja tem uma assinatura vigente; use a troca de plano",
        { tenantId },
      );
    }

    const plan = await this.plans.getByCode(input.planCode);
    const limits = await this.policy.ensureFits(tenantId, plan);
    const now = this.clock.now();

    const subscription = Subscription.start({
      id: this.ids.generate(),
      tenantId,
      plan,
      createdBy: ctx.requireUserId(),
      now,
    });

    const saved = await this.subscriptions.insert(subscription);
    await this.events.publish(subscription.pullEvents());
    await this.audit.record({
      action: "subscription.started",
      resourceType: "subscription",
      resourceId: saved.id,
      metadata: { planCode: plan.code },
    });

    return {
      subscription: SubscriptionPresenter.toDto(saved, now),
      plan: PlanPresenter.toDto(plan),
      limits: SubscriptionPresenter.limitsToDto(limits),
    };
  }
}

export class GetCurrentSubscriptionUseCase extends BaseUseCase<void, Record<string, unknown>> {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly plans: PlanRepository,
    private readonly policy: PlanLimitPolicy,
    private readonly clock: Clock,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "billing.subscription.read";
  }

  protected override async handle(
    _input: void,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();
    const subscription = await this.subscriptions.getLive(tenantId);
    const plan = await this.plans.getById(subscription.planId);
    const limits = await this.policy.check(tenantId, plan);
    const now = this.clock.now();

    return {
      subscription: SubscriptionPresenter.toDto(subscription, now),
      plan: PlanPresenter.toDto(plan),
      limits: SubscriptionPresenter.limitsToDto(limits),
    };
  }
}

/**
 * Troca de plano com rateio. Descer de plano exige que o consumo atual caiba
 * nos limites do plano de destino.
 */
export class ChangePlanUseCase extends BaseUseCase<{ planCode: string }, Record<string, unknown>> {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly plans: PlanRepository,
    private readonly policy: PlanLimitPolicy,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "billing.subscription.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: { planCode: string },
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();
    const subscription = await this.subscriptions.getLive(tenantId);
    const plan = await this.plans.getByCode(input.planCode);

    const limits = await this.policy.ensureFits(tenantId, plan);
    const now = this.clock.now();
    const proration = subscription.changePlan(plan, now);

    const saved = await this.subscriptions.save(subscription);
    await this.events.publish(subscription.pullEvents());
    await this.audit.record({
      action: "subscription.plan_changed",
      resourceType: "subscription",
      resourceId: saved.id,
      metadata: { planCode: plan.code, differenceCents: proration.difference.cents },
    });

    return {
      subscription: SubscriptionPresenter.toDto(saved, now),
      plan: PlanPresenter.toDto(plan),
      proration: SubscriptionPresenter.prorationToDto(proration),
      limits: SubscriptionPresenter.limitsToDto(limits),
    };
  }
}

export class CancelSubscriptionUseCase
  extends BaseUseCase<{ atPeriodEnd: boolean }, Record<string, unknown>> {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "billing.subscription.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: { atPeriodEnd: boolean },
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const now = this.clock.now();
    const subscription = await this.subscriptions.getLive(ctx.requireTenantId());

    subscription.cancel(input.atPeriodEnd, now);
    const saved = await this.subscriptions.save(subscription);

    await this.events.publish(subscription.pullEvents());
    await this.audit.record({
      action: "subscription.cancelled",
      resourceType: "subscription",
      resourceId: saved.id,
      metadata: { atPeriodEnd: input.atPeriodEnd },
    });
    return SubscriptionPresenter.toDto(saved, now);
  }
}

export interface RecordUsageInput {
  metric: string;
  quantity: number;
  recordedAt?: Date;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export class RecordUsageUseCase extends BaseUseCase<RecordUsageInput, Record<string, unknown>> {
  constructor(
    private readonly usage: UsageRepository,
    private readonly subscriptions: SubscriptionRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "billing.usage.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: RecordUsageInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();
    const subscription = await this.subscriptions.findLive(tenantId);
    const id = this.ids.generate();
    const recordedAt = input.recordedAt ?? this.clock.now();

    await this.usage.record({
      id,
      tenantId,
      subscriptionId: subscription?.id ?? null,
      metric: input.metric,
      quantity: input.quantity,
      recordedAt,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: input.metadata ?? {},
      createdBy: ctx.actor.userId,
    });

    await this.events.publish([
      new UsageRecorded(tenantId, id, input.metric, input.quantity),
    ]);
    return {
      id,
      metric: input.metric,
      quantity: input.quantity,
      recordedAt: recordedAt.toISOString(),
    };
  }
}

export class GetUsageUseCase extends BaseUseCase<void, Record<string, unknown>> {
  constructor(
    private readonly usage: UsageRepository,
    private readonly subscriptions: SubscriptionRepository,
    private readonly clock: Clock,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "billing.usage.read";
  }

  protected override async handle(
    _input: void,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();
    const subscription = await this.subscriptions.findLive(tenantId);
    const from = subscription?.period.start ??
      new Date(this.clock.now().getTime() - 30 * 86_400_000);
    const to = subscription?.period.end ?? this.clock.now();

    return UsagePresenter.toDto(await this.usage.totals(tenantId, from, to), from, to);
  }
}
