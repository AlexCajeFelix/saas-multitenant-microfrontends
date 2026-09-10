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
import { Deal } from "../../domain/entities.ts";
import type {
  CompanyRepository,
  ContactRepository,
  DealFilter,
  DealRepository,
  PipelineRepository,
} from "../../domain/ports.ts";
import { ActivityPresenter, DealPresenter, PipelinePresenter } from "../dto.ts";

export interface CreateDealInput {
  title: string;
  stageKey?: string;
  companyId?: string;
  contactId?: string;
  amountCents: number;
  currency: string;
  expectedCloseDate?: Date;
  ownerId?: string;
}

export class CreateDealUseCase extends BaseUseCase<CreateDealInput, Record<string, unknown>> {
  constructor(
    private readonly deals: DealRepository,
    private readonly pipelines: PipelineRepository,
    private readonly companies: CompanyRepository,
    private readonly contacts: ContactRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "crm.deal.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: CreateDealInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();

    if (input.companyId) await this.companies.getById(input.companyId);
    if (input.contactId) await this.contacts.getById(input.contactId);

    const deal = Deal.create({
      id: this.ids.generate(),
      tenantId,
      pipeline: await this.pipelines.load(tenantId),
      createdBy: ctx.requireUserId(),
      now: this.clock.now(),
      title: input.title,
      stageKey: input.stageKey,
      companyId: input.companyId,
      contactId: input.contactId,
      amountCents: input.amountCents,
      currency: input.currency,
      expectedCloseDate: input.expectedCloseDate ?? null,
      ownerId: input.ownerId,
    });

    const saved = await this.deals.insert(deal);
    await this.events.publish(deal.pullEvents());
    await this.audit.record({
      action: "deal.created",
      resourceType: "deal",
      resourceId: saved.id,
      metadata: { title: saved.title, amountCents: saved.amount.cents },
    });
    return DealPresenter.toDto(saved);
  }
}

export class ListDealsUseCase
  extends BaseUseCase<{ filter: DealFilter; page: PageRequest }, Record<string, unknown>> {
  constructor(private readonly deals: DealRepository) {
    super();
  }
  protected override get permission(): string | null {
    return "crm.deal.read";
  }
  protected override async handle(
    input: { filter: DealFilter; page: PageRequest },
  ): Promise<Record<string, unknown>> {
    const result: Page<unknown> = (await this.deals.search(input.filter, input.page))
      .map((deal) => DealPresenter.toDto(deal));
    return result.toJSON();
  }
}

export class GetDealUseCase extends BaseUseCase<{ id: string }, Record<string, unknown>> {
  constructor(private readonly deals: DealRepository) {
    super();
  }
  protected override get permission(): string | null {
    return "crm.deal.read";
  }
  protected override async handle(input: { id: string }): Promise<Record<string, unknown>> {
    return DealPresenter.toDto(await this.deals.getById(input.id, true), true);
  }
}

export interface UpdateDealInput {
  id: string;
  title?: string;
  companyId?: string;
  contactId?: string;
  amountCents?: number;
  currency?: string;
  expectedCloseDate?: Date;
  ownerId?: string;
}

export class UpdateDealUseCase extends BaseUseCase<UpdateDealInput, Record<string, unknown>> {
  constructor(
    private readonly deals: DealRepository,
    private readonly clock: Clock,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "crm.deal.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(input: UpdateDealInput): Promise<Record<string, unknown>> {
    const { id, ...patch } = input;
    const deal = await this.deals.getById(id);
    deal.update(patch, this.clock.now());
    const saved = await this.deals.save(deal);
    await this.audit.record({
      action: "deal.updated",
      resourceType: "deal",
      resourceId: id,
      metadata: { fields: Object.keys(patch) },
    });
    return DealPresenter.toDto(saved);
  }
}

export class MoveDealStageUseCase
  extends BaseUseCase<{ id: string; stageKey: string }, Record<string, unknown>> {
  constructor(
    private readonly deals: DealRepository,
    private readonly pipelines: PipelineRepository,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "crm.deal.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: { id: string; stageKey: string },
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const deal = await this.deals.getById(input.id);
    const pipeline = await this.pipelines.load(ctx.requireTenantId());

    deal.moveTo(input.stageKey, pipeline, this.clock.now());
    const saved = await this.deals.save(deal);

    await this.events.publish(deal.pullEvents());
    await this.audit.record({
      action: "deal.stage_changed",
      resourceType: "deal",
      resourceId: saved.id,
      metadata: { stageKey: saved.stageKey },
    });
    return DealPresenter.toDto(saved);
  }
}

export interface CloseDealInput {
  id: string;
  reason?: string;
}

/** Fecha o negocio como ganho ou perdido. Ambos sao terminais. */
export class CloseDealUseCase extends BaseUseCase<CloseDealInput, Record<string, unknown>> {
  constructor(
    private readonly outcome: "won" | "lost",
    private readonly deals: DealRepository,
    private readonly pipelines: PipelineRepository,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "crm.deal.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: CloseDealInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const deal = await this.deals.getById(input.id);
    const pipeline = await this.pipelines.load(ctx.requireTenantId());
    const now = this.clock.now();

    if (this.outcome === "won") deal.win(pipeline, now);
    else deal.lose(input.reason ?? "Nao informado", pipeline, now);

    const saved = await this.deals.save(deal);
    await this.events.publish(deal.pullEvents());
    await this.audit.record({
      action: `deal.${this.outcome}`,
      resourceType: "deal",
      resourceId: saved.id,
      metadata: { amountCents: saved.amount.cents, reason: saved.lostReason },
    });
    return DealPresenter.toDto(saved);
  }
}

export interface LogActivityInput {
  id: string;
  kind: string;
  subject: string;
  notes: string;
  occurredAt?: Date;
}

export class LogActivityUseCase extends BaseUseCase<LogActivityInput, Record<string, unknown>> {
  constructor(
    private readonly deals: DealRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "crm.activity.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: LogActivityInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const deal = await this.deals.getById(input.id);
    const activity = deal.logActivity({
      id: this.ids.generate(),
      kind: input.kind,
      subject: input.subject,
      notes: input.notes,
      occurredAt: input.occurredAt,
      createdBy: ctx.requireUserId(),
      now: this.clock.now(),
    });

    await this.deals.save(deal);
    await this.events.publish(deal.pullEvents());
    await this.audit.record({
      action: "activity.logged",
      resourceType: "activity",
      resourceId: activity.id,
      metadata: { dealId: deal.id, kind: activity.kind },
    });
    return ActivityPresenter.toDto(activity);
  }
}

export class GetPipelineUseCase extends BaseUseCase<void, Record<string, unknown>> {
  constructor(private readonly pipelines: PipelineRepository) {
    super();
  }

  protected override get permission(): string | null {
    return "crm.pipeline.read";
  }

  protected override async handle(
    _input: void,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    return PipelinePresenter.toDto(await this.pipelines.summary(ctx.requireTenantId()));
  }
}
