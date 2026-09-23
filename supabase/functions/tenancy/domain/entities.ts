import { AggregateRoot, BusinessRuleError, Email, Guard, Slug } from "../../_shared/mod.ts";
import {
  InvitationAccepted,
  MemberInvited,
  MemberRemoved,
  MemberRoleChanged,
  TenantCreated,
  TenantStatusChanged,
} from "./events.ts";
import {
  InvitationStatus,
  InvitationToken,
  MemberRole,
  MembershipStatus,
  TenantStatus,
} from "./value-objects.ts";

interface TenantProps extends Record<string, unknown> {
  slug: Slug;
  name: string;
  status: TenantStatus;
  settings: Record<string, unknown>;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * O tenant. Raiz do agregado que define a fronteira de isolamento de todo o
 * sistema: cada linha de cada modulo pertence a exatamente um destes.
 */
export class Tenant extends AggregateRoot<TenantProps> {
  private constructor(id: string, props: TenantProps) {
    super(id, props);
  }

  static create(input: {
    id: string;
    name: string;
    slug: string;
    ownerId: string;
    settings?: Record<string, unknown>;
    now: Date;
  }): Tenant {
    const tenant = new Tenant(input.id, {
      slug: Slug.create(input.slug),
      name: Guard.length(input.name, "name", 2, 120),
      status: TenantStatus.active(),
      settings: input.settings ?? {},
      createdBy: input.ownerId,
      createdAt: input.now,
      updatedAt: input.now,
    });
    tenant.record(new TenantCreated(input.id, tenant.slug, input.ownerId));
    return tenant;
  }

  /** Reidrata a partir do banco. Nao emite evento: nada aconteceu de novo. */
  static restore(id: string, props: TenantProps): Tenant {
    return new Tenant(id, props);
  }

  override get tenantId(): string {
    return this._id;
  }

  get slug(): string {
    return this.props.slug.value;
  }
  get name(): string {
    return this.props.name;
  }
  get status(): TenantStatus {
    return this.props.status;
  }
  get settings(): Record<string, unknown> {
    return this.props.settings;
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
  get isActive(): boolean {
    return this.props.status.isActive;
  }

  rename(name: string, now: Date): void {
    this.props.name = Guard.length(name, "name", 2, 120);
    this.props.updatedAt = now;
  }

  /** Mescla, nao substitui: um cliente parcial nao apaga o que nao enviou. */
  mergeSettings(patch: Record<string, unknown>, now: Date): void {
    this.props.settings = { ...this.props.settings, ...patch };
    this.props.updatedAt = now;
  }

  suspend(reason: string | null, now: Date): void {
    const from = this.props.status.value;
    this.props.status = this.props.status.transitionTo("suspended");
    this.props.updatedAt = now;
    this.record(new TenantStatusChanged(this._id, from, "suspended", reason));
  }

  activate(now: Date): void {
    const from = this.props.status.value;
    this.props.status = this.props.status.transitionTo("active");
    this.props.updatedAt = now;
    this.record(new TenantStatusChanged(this._id, from, "active", null));
  }

  cancel(reason: string | null, now: Date): void {
    const from = this.props.status.value;
    this.props.status = this.props.status.transitionTo("cancelled");
    this.props.updatedAt = now;
    this.record(new TenantStatusChanged(this._id, from, "cancelled", reason));
  }
}

interface MembershipProps extends Record<string, unknown> {
  tenantId: string;
  userId: string;
  role: MemberRole;
  status: MembershipStatus;
  invitedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** O vinculo entre um usuario e um tenant, com o papel que ele exerce ali. */
export class Membership extends AggregateRoot<MembershipProps> {
  private constructor(id: string, props: MembershipProps) {
    super(id, props);
  }

  static create(input: {
    id: string;
    tenantId: string;
    userId: string;
    role: string;
    invitedBy?: string | null;
    now: Date;
  }): Membership {
    return new Membership(input.id, {
      tenantId: input.tenantId,
      userId: input.userId,
      role: MemberRole.create(input.role),
      status: MembershipStatus.active(),
      invitedBy: input.invitedBy ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static restore(id: string, props: MembershipProps): Membership {
    return new Membership(id, props);
  }

  override get tenantId(): string {
    return this.props.tenantId;
  }
  get userId(): string {
    return this.props.userId;
  }
  get role(): MemberRole {
    return this.props.role;
  }
  get status(): MembershipStatus {
    return this.props.status;
  }
  get invitedBy(): string | null {
    return this.props.invitedBy;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
  get isOwner(): boolean {
    return this.props.role.isOwner;
  }
  get isActive(): boolean {
    return this.props.status.isActive;
  }

  changeRole(role: string, now: Date): void {
    const next = MemberRole.create(role);
    if (next.equals(this.props.role)) return;
    const from = this.props.role.value;
    this.props.role = next;
    this.props.updatedAt = now;
    this.record(new MemberRoleChanged(this.tenantId, this._id, this.userId, from, next.value));
  }

  revoke(now: Date): void {
    if (!this.props.status.isActive) {
      throw new BusinessRuleError("Este membro ja foi removido");
    }
    this.props.status = MembershipStatus.create("revoked");
    this.props.updatedAt = now;
    this.record(new MemberRemoved(this.tenantId, this._id, this.userId));
  }
}

interface InvitationProps extends Record<string, unknown> {
  tenantId: string;
  email: Email;
  role: MemberRole;
  token: InvitationToken;
  status: InvitationStatus;
  invitedBy: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedBy: string | null;
  createdAt: Date;
}

/** Convite pendente para entrar em um tenant. */
export class Invitation extends AggregateRoot<InvitationProps> {
  private constructor(id: string, props: InvitationProps) {
    super(id, props);
  }

  static issue(input: {
    id: string;
    tenantId: string;
    email: string;
    role: string;
    tokenHash: string;
    invitedBy: string | null;
    validForDays: number;
    now: Date;
  }): Invitation {
    Guard.range(input.validForDays, "validForDays", 1, 30);
    const expiresAt = new Date(input.now.getTime() + input.validForDays * 86_400_000);

    const invitation = new Invitation(input.id, {
      tenantId: input.tenantId,
      email: Email.create(input.email),
      role: MemberRole.create(input.role),
      token: InvitationToken.fromHash(input.tokenHash),
      status: InvitationStatus.pending(),
      invitedBy: input.invitedBy,
      expiresAt,
      acceptedAt: null,
      acceptedBy: null,
      createdAt: input.now,
    });
    invitation.record(
      new MemberInvited(input.tenantId, input.id, invitation.email, invitation.role.value),
    );
    return invitation;
  }

  static restore(id: string, props: InvitationProps): Invitation {
    return new Invitation(id, props);
  }

  override get tenantId(): string {
    return this.props.tenantId;
  }
  get email(): string {
    return this.props.email.value;
  }
  get role(): MemberRole {
    return this.props.role;
  }
  get tokenHash(): string {
    return this.props.token.hash;
  }
  get status(): InvitationStatus {
    return this.props.status;
  }
  get invitedBy(): string | null {
    return this.props.invitedBy;
  }
  get expiresAt(): Date {
    return this.props.expiresAt;
  }
  get acceptedAt(): Date | null {
    return this.props.acceptedAt;
  }
  get acceptedBy(): string | null {
    return this.props.acceptedBy;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }

  hasExpired(now: Date): boolean {
    return this.props.expiresAt.getTime() <= now.getTime();
  }

  /**
   * Aceita o convite. Confere situacao, validade e se o e-mail de quem aceita
   * e o mesmo que foi convidado: um token vazado nao serve para outra conta.
   */
  accept(userId: string, userEmail: string, now: Date): void {
    if (!this.props.status.isPending) {
      throw new BusinessRuleError(`Convite ${this.props.status.value}`, {
        status: this.props.status.value,
      });
    }
    if (this.hasExpired(now)) {
      this.props.status = InvitationStatus.of("expired");
      throw new BusinessRuleError("Convite expirado", {
        expiresAt: this.props.expiresAt.toISOString(),
      });
    }
    if (Email.create(userEmail).value !== this.props.email.value) {
      throw new BusinessRuleError("Este convite foi enviado para outro e-mail", {
        invited: this.props.email.value,
      });
    }

    this.props.status = InvitationStatus.of("accepted");
    this.props.acceptedAt = now;
    this.props.acceptedBy = userId;
    this.record(new InvitationAccepted(this.tenantId, this._id, userId));
  }

  revoke(): void {
    if (!this.props.status.isPending) {
      throw new BusinessRuleError("So convites pendentes podem ser revogados", {
        status: this.props.status.value,
      });
    }
    this.props.status = InvitationStatus.of("revoked");
  }
}
