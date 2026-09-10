import { DomainEvent } from "../../_shared/mod.ts";

export class TenantCreated extends DomainEvent {
  constructor(tenantId: string, readonly slug: string, readonly ownerId: string) {
    super(tenantId, tenantId);
  }
  override get name(): string {
    return "tenancy.tenant.created";
  }
  override get aggregateType(): string {
    return "Tenant";
  }
  override payload(): Record<string, unknown> {
    return { slug: this.slug, ownerId: this.ownerId };
  }
}

export class TenantStatusChanged extends DomainEvent {
  constructor(
    tenantId: string,
    readonly from: string,
    readonly to: string,
    readonly reason: string | null,
  ) {
    super(tenantId, tenantId);
  }
  override get name(): string {
    return `tenancy.tenant.${this.to}`;
  }
  override get aggregateType(): string {
    return "Tenant";
  }
  override payload(): Record<string, unknown> {
    return { from: this.from, to: this.to, reason: this.reason };
  }
}

export class MemberInvited extends DomainEvent {
  constructor(
    tenantId: string,
    invitationId: string,
    readonly email: string,
    readonly role: string,
  ) {
    super(tenantId, invitationId);
  }
  override get name(): string {
    return "tenancy.member.invited";
  }
  override get aggregateType(): string {
    return "Invitation";
  }
  override payload(): Record<string, unknown> {
    return { email: this.email, role: this.role };
  }
}

export class InvitationAccepted extends DomainEvent {
  constructor(tenantId: string, invitationId: string, readonly userId: string) {
    super(tenantId, invitationId);
  }
  override get name(): string {
    return "tenancy.invitation.accepted";
  }
  override get aggregateType(): string {
    return "Invitation";
  }
  override payload(): Record<string, unknown> {
    return { userId: this.userId };
  }
}

export class MemberRoleChanged extends DomainEvent {
  constructor(
    tenantId: string,
    membershipId: string,
    readonly userId: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(tenantId, membershipId);
  }
  override get name(): string {
    return "tenancy.member.role_changed";
  }
  override get aggregateType(): string {
    return "Membership";
  }
  override payload(): Record<string, unknown> {
    return { userId: this.userId, from: this.from, to: this.to };
  }
}

export class MemberRemoved extends DomainEvent {
  constructor(tenantId: string, membershipId: string, readonly userId: string) {
    super(tenantId, membershipId);
  }
  override get name(): string {
    return "tenancy.member.removed";
  }
  override get aggregateType(): string {
    return "Membership";
  }
  override payload(): Record<string, unknown> {
    return { userId: this.userId };
  }
}
