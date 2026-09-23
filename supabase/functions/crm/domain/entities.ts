import {
  AggregateRoot,
  BusinessRuleError,
  Email,
  Entity,
  Guard,
  Money,
} from "../../_shared/mod.ts";
import {
  ActivityLogged,
  CompanyCreated,
  ContactCreated,
  DealClosed,
  DealCreated,
  DealStageChanged,
} from "./events.ts";
import { ActivityKind, DealStatus, PersonName, type Pipeline } from "./value-objects.ts";

interface CompanyProps extends Record<string, unknown> {
  tenantId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  website: string | null;
  phone: string | null;
  address: Record<string, unknown>;
  ownerId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Company extends AggregateRoot<CompanyProps> {
  private constructor(id: string, props: CompanyProps) {
    super(id, props);
  }

  static create(input: {
    id: string;
    tenantId: string;
    name: string;
    domain?: string;
    industry?: string;
    size?: string;
    website?: string;
    phone?: string;
    address?: Record<string, unknown>;
    ownerId?: string | null;
    createdBy: string;
    now: Date;
  }): Company {
    const company = new Company(input.id, {
      tenantId: input.tenantId,
      name: Guard.length(input.name, "name", 1, 160),
      domain: input.domain?.toLowerCase() ?? null,
      industry: input.industry ?? null,
      size: input.size ?? null,
      website: input.website ?? null,
      phone: input.phone ?? null,
      address: input.address ?? {},
      ownerId: input.ownerId ?? input.createdBy,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
    });
    company.record(new CompanyCreated(input.tenantId, input.id, company.name));
    return company;
  }

  static restore(id: string, props: CompanyProps): Company {
    return new Company(id, props);
  }

  override get tenantId(): string {
    return this.props.tenantId;
  }
  get name(): string {
    return this.props.name;
  }
  get domain(): string | null {
    return this.props.domain;
  }
  get industry(): string | null {
    return this.props.industry;
  }
  get size(): string | null {
    return this.props.size;
  }
  get website(): string | null {
    return this.props.website;
  }
  get phone(): string | null {
    return this.props.phone;
  }
  get address(): Record<string, unknown> {
    return this.props.address;
  }
  get ownerId(): string | null {
    return this.props.ownerId;
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

  update(
    patch: Partial<{
      name: string;
      domain: string | null;
      industry: string | null;
      size: string | null;
      website: string | null;
      phone: string | null;
      address: Record<string, unknown>;
      ownerId: string | null;
    }>,
    now: Date,
  ): void {
    if (patch.name !== undefined) this.props.name = Guard.length(patch.name, "name", 1, 160);
    if (patch.domain !== undefined) this.props.domain = patch.domain?.toLowerCase() ?? null;
    if (patch.industry !== undefined) this.props.industry = patch.industry;
    if (patch.size !== undefined) this.props.size = patch.size;
    if (patch.website !== undefined) this.props.website = patch.website;
    if (patch.phone !== undefined) this.props.phone = patch.phone;
    if (patch.address !== undefined) {
      this.props.address = { ...this.props.address, ...patch.address };
    }
    if (patch.ownerId !== undefined) this.props.ownerId = patch.ownerId;
    this.props.updatedAt = now;
  }
}

interface ContactProps extends Record<string, unknown> {
  tenantId: string;
  companyId: string | null;
  name: PersonName;
  email: Email | null;
  phone: string | null;
  jobTitle: string | null;
  ownerId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Contact extends AggregateRoot<ContactProps> {
  private constructor(id: string, props: ContactProps) {
    super(id, props);
  }

  static create(input: {
    id: string;
    tenantId: string;
    companyId?: string | null;
    firstName: string;
    lastName?: string;
    email?: string;
    phone?: string;
    jobTitle?: string;
    ownerId?: string | null;
    createdBy: string;
    now: Date;
  }): Contact {
    const contact = new Contact(input.id, {
      tenantId: input.tenantId,
      companyId: input.companyId ?? null,
      name: PersonName.create(input.firstName, input.lastName),
      email: input.email ? Email.create(input.email) : null,
      phone: input.phone ?? null,
      jobTitle: input.jobTitle ?? null,
      ownerId: input.ownerId ?? input.createdBy,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
    });
    contact.record(new ContactCreated(input.tenantId, input.id, contact.email));
    return contact;
  }

  static restore(id: string, props: ContactProps): Contact {
    return new Contact(id, props);
  }

  override get tenantId(): string {
    return this.props.tenantId;
  }
  get companyId(): string | null {
    return this.props.companyId;
  }
  get firstName(): string {
    return this.props.name.first;
  }
  get lastName(): string {
    return this.props.name.last;
  }
  get fullName(): string {
    return this.props.name.full;
  }
  get email(): string | null {
    return this.props.email?.value ?? null;
  }
  get phone(): string | null {
    return this.props.phone;
  }
  get jobTitle(): string | null {
    return this.props.jobTitle;
  }
  get ownerId(): string | null {
    return this.props.ownerId;
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

  update(
    patch: Partial<{
      companyId: string | null;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      jobTitle: string | null;
      ownerId: string | null;
    }>,
    now: Date,
  ): void {
    if (patch.firstName !== undefined || patch.lastName !== undefined) {
      this.props.name = PersonName.create(
        patch.firstName ?? this.props.name.first,
        patch.lastName ?? this.props.name.last,
      );
    }
    if (patch.companyId !== undefined) this.props.companyId = patch.companyId;
    if (patch.email !== undefined) {
      this.props.email = patch.email ? Email.create(patch.email) : null;
    }
    if (patch.phone !== undefined) this.props.phone = patch.phone;
    if (patch.jobTitle !== undefined) this.props.jobTitle = patch.jobTitle;
    if (patch.ownerId !== undefined) this.props.ownerId = patch.ownerId;
    this.props.updatedAt = now;
  }
}

interface ActivityProps extends Record<string, unknown> {
  tenantId: string;
  dealId: string;
  kind: ActivityKind;
  subject: string;
  notes: string;
  occurredAt: Date;
  createdBy: string | null;
  createdAt: Date;
}

/** Entidade filha do agregado Deal: nunca existe sozinha. */
export class Activity extends Entity<ActivityProps> {
  private constructor(id: string, props: ActivityProps) {
    super(id, props);
  }

  static create(input: {
    id: string;
    tenantId: string;
    dealId: string;
    kind: string;
    subject: string;
    notes?: string;
    occurredAt?: Date;
    createdBy: string;
    now: Date;
  }): Activity {
    return new Activity(input.id, {
      tenantId: input.tenantId,
      dealId: input.dealId,
      kind: ActivityKind.create(input.kind),
      subject: Guard.length(input.subject, "subject", 2, 160),
      notes: (input.notes ?? "").slice(0, 4000),
      occurredAt: input.occurredAt ?? input.now,
      createdBy: input.createdBy,
      createdAt: input.now,
    });
  }

  static restore(id: string, props: ActivityProps): Activity {
    return new Activity(id, props);
  }

  get tenantId(): string {
    return this.props.tenantId;
  }
  get dealId(): string {
    return this.props.dealId;
  }
  get kind(): string {
    return this.props.kind.value;
  }
  get subject(): string {
    return this.props.subject;
  }
  get notes(): string {
    return this.props.notes;
  }
  get occurredAt(): Date {
    return this.props.occurredAt;
  }
  get createdBy(): string | null {
    return this.props.createdBy;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
}

interface DealProps extends Record<string, unknown> {
  tenantId: string;
  title: string;
  companyId: string | null;
  contactId: string | null;
  stageKey: string;
  status: DealStatus;
  amount: Money;
  probability: number;
  expectedCloseDate: Date | null;
  closedAt: Date | null;
  lostReason: string | null;
  ownerId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  activities: Activity[];
}

/**
 * Negocio: a raiz do agregado do funil de vendas.
 *
 * Concentra a maquina de estados do CRM. As transicoes sao validadas contra o
 * funil configurado pelo tenant, e negocio fechado nao se move mais.
 */
export class Deal extends AggregateRoot<DealProps> {
  private newActivities: Activity[] = [];

  private constructor(id: string, props: DealProps) {
    super(id, props);
  }

  static create(input: {
    id: string;
    tenantId: string;
    title: string;
    pipeline: Pipeline;
    stageKey?: string;
    companyId?: string | null;
    contactId?: string | null;
    amountCents?: number;
    currency?: string;
    expectedCloseDate?: Date | null;
    ownerId?: string | null;
    createdBy: string;
    now: Date;
  }): Deal {
    const stage = input.stageKey ? input.pipeline.require(input.stageKey) : input.pipeline.first;
    input.pipeline.ensureMovable(stage);

    if (input.expectedCloseDate) {
      const limit = new Date(input.now.getTime() - 86_400_000);
      Guard.rule(
        input.expectedCloseDate.getTime() >= limit.getTime(),
        "A data prevista de fechamento nao pode estar no passado",
        { expectedCloseDate: input.expectedCloseDate.toISOString() },
      );
    }

    const amount = Money.fromCents(input.amountCents ?? 0, input.currency ?? "BRL");
    Guard.rule(!amount.isNegative, "O valor do negocio nao pode ser negativo");

    const deal = new Deal(input.id, {
      tenantId: input.tenantId,
      title: Guard.length(input.title, "title", 2, 160),
      companyId: input.companyId ?? null,
      contactId: input.contactId ?? null,
      stageKey: stage.key,
      status: DealStatus.open(),
      amount,
      probability: stage.probability,
      expectedCloseDate: input.expectedCloseDate ?? null,
      closedAt: null,
      lostReason: null,
      ownerId: input.ownerId ?? input.createdBy,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
      activities: [],
    });
    deal.record(
      new DealCreated(input.tenantId, input.id, deal.title, amount.cents, amount.currency),
    );
    return deal;
  }

  static restore(id: string, props: DealProps): Deal {
    return new Deal(id, props);
  }

  override get tenantId(): string {
    return this.props.tenantId;
  }
  get title(): string {
    return this.props.title;
  }
  get companyId(): string | null {
    return this.props.companyId;
  }
  get contactId(): string | null {
    return this.props.contactId;
  }
  get stageKey(): string {
    return this.props.stageKey;
  }
  get status(): DealStatus {
    return this.props.status;
  }
  get amount(): Money {
    return this.props.amount;
  }
  get probability(): number {
    return this.props.probability;
  }
  get expectedCloseDate(): Date | null {
    return this.props.expectedCloseDate;
  }
  get closedAt(): Date | null {
    return this.props.closedAt;
  }
  get lostReason(): string | null {
    return this.props.lostReason;
  }
  get ownerId(): string | null {
    return this.props.ownerId;
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
  get activities(): readonly Activity[] {
    return this.props.activities;
  }

  /** Valor ponderado pela probabilidade do estagio: a previsao do funil. */
  get weightedAmount(): Money {
    return this.props.amount.percentage(this.props.probability);
  }

  private assertOpen(operation: string): void {
    if (this.props.status.isClosed) {
      throw new BusinessRuleError(
        `Negocio ja ${
          this.props.status.value === "won" ? "ganho" : "perdido"
        }: ${operation} nao e permitido`,
        { dealId: this._id, status: this.props.status.value },
      );
    }
  }

  update(
    patch: Partial<{
      title: string;
      companyId: string | null;
      contactId: string | null;
      amountCents: number;
      currency: string;
      expectedCloseDate: Date | null;
      ownerId: string | null;
    }>,
    now: Date,
  ): void {
    this.assertOpen("editar");
    if (patch.title !== undefined) this.props.title = Guard.length(patch.title, "title", 2, 160);
    if (patch.companyId !== undefined) this.props.companyId = patch.companyId;
    if (patch.contactId !== undefined) this.props.contactId = patch.contactId;
    if (patch.amountCents !== undefined) {
      this.props.amount = Money.fromCents(
        patch.amountCents,
        patch.currency ?? this.props.amount.currency,
      );
    }
    if (patch.expectedCloseDate !== undefined) {
      this.props.expectedCloseDate = patch.expectedCloseDate;
    }
    if (patch.ownerId !== undefined) this.props.ownerId = patch.ownerId;
    this.props.updatedAt = now;
  }

  /** Move o negocio no funil, adotando a probabilidade do estagio de destino. */
  moveTo(stageKey: string, pipeline: Pipeline, now: Date): void {
    this.assertOpen("mover de estagio");
    const target = pipeline.require(stageKey);
    pipeline.ensureMovable(target);

    if (target.key === this.props.stageKey) return;

    const from = this.props.stageKey;
    this.props.stageKey = target.key;
    this.props.probability = target.probability;
    this.props.updatedAt = now;
    this.record(
      new DealStageChanged(this.tenantId, this._id, from, target.key, target.probability),
    );
  }

  win(pipeline: Pipeline, now: Date): void {
    this.assertOpen("marcar como ganho");
    this.props.stageKey = pipeline.wonStage?.key ?? this.props.stageKey;
    this.props.status = DealStatus.won();
    this.props.probability = 100;
    this.props.closedAt = now;
    this.props.lostReason = null;
    this.props.updatedAt = now;
    this.record(new DealClosed(this.tenantId, this._id, "won", this.props.amount.cents, null));
  }

  lose(reason: string, pipeline: Pipeline, now: Date): void {
    this.assertOpen("marcar como perdido");
    this.props.stageKey = pipeline.lostStage?.key ?? this.props.stageKey;
    this.props.status = DealStatus.lost();
    this.props.probability = 0;
    this.props.closedAt = now;
    this.props.lostReason = Guard.length(reason, "reason", 3, 240);
    this.props.updatedAt = now;
    this.record(
      new DealClosed(
        this.tenantId,
        this._id,
        "lost",
        this.props.amount.cents,
        this.props.lostReason,
      ),
    );
  }

  /** Atividades entram pelo agregado, nunca direto no repositorio. */
  logActivity(input: {
    id: string;
    kind: string;
    subject: string;
    notes?: string;
    occurredAt?: Date;
    createdBy: string;
    now: Date;
  }): Activity {
    const activity = Activity.create({
      id: input.id,
      tenantId: this.tenantId,
      dealId: this._id,
      kind: input.kind,
      subject: input.subject,
      notes: input.notes,
      occurredAt: input.occurredAt,
      createdBy: input.createdBy,
      now: input.now,
    });
    this.props.activities = [activity, ...this.props.activities];
    this.newActivities.push(activity);
    this.props.updatedAt = input.now;
    this.record(new ActivityLogged(this.tenantId, this._id, activity.id, activity.kind));
    return activity;
  }

  /** O repositorio consome isto para gravar as filhas junto com a raiz. */
  pullNewActivities(): Activity[] {
    const pending = this.newActivities;
    this.newActivities = [];
    return pending;
  }
}
