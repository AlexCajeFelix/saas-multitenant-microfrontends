import { DomainEvent } from "../../_shared/mod.ts";

export class RoleCreated extends DomainEvent {
  constructor(tenantId: string, roleId: string, readonly slug: string) {
    super(tenantId, roleId);
  }
  override get name(): string {
    return "iam.role.created";
  }
  override get aggregateType(): string {
    return "Role";
  }
  override payload(): Record<string, unknown> {
    return { slug: this.slug };
  }
}

export class RolePermissionsChanged extends DomainEvent {
  constructor(
    tenantId: string,
    roleId: string,
    readonly granted: string[],
    readonly revoked: string[],
  ) {
    super(tenantId, roleId);
  }
  override get name(): string {
    return "iam.role.permissions_changed";
  }
  override get aggregateType(): string {
    return "Role";
  }
  override payload(): Record<string, unknown> {
    return { granted: this.granted, revoked: this.revoked };
  }
}

export class ApiKeyIssued extends DomainEvent {
  constructor(
    tenantId: string,
    keyId: string,
    readonly prefix: string,
    readonly label: string,
  ) {
    super(tenantId, keyId);
  }
  override get name(): string {
    return "iam.api_key.issued";
  }
  override get aggregateType(): string {
    return "ApiKey";
  }
  override payload(): Record<string, unknown> {
    return { prefix: this.prefix, name: this.label };
  }
}

export class ApiKeyRevoked extends DomainEvent {
  constructor(tenantId: string, keyId: string, readonly prefix: string) {
    super(tenantId, keyId);
  }
  override get name(): string {
    return "iam.api_key.revoked";
  }
  override get aggregateType(): string {
    return "ApiKey";
  }
  override payload(): Record<string, unknown> {
    return { prefix: this.prefix };
  }
}

export class RoleAssigned extends DomainEvent {
  constructor(
    tenantId: string,
    userId: string,
    readonly roleSlug: string,
    readonly previousRole: string | null,
  ) {
    super(tenantId, userId);
  }
  override get name(): string {
    return "iam.role.assigned";
  }
  override get aggregateType(): string {
    return "Membership";
  }
  override payload(): Record<string, unknown> {
    return { roleSlug: this.roleSlug, previousRole: this.previousRole };
  }
}
