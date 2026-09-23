import {
  type AuditTrail,
  BaseUseCase,
  BusinessRuleError,
  type Clock,
  ConflictError,
  type EventPublisher,
  type IdGenerator,
  NotFoundError,
  type RequestContext,
} from "../../../_shared/mod.ts";
import { Role } from "../../domain/entities.ts";
import type {
  MembershipAssignments,
  PermissionCatalog,
  RoleRepository,
} from "../../domain/ports.ts";
import type { RoleAuthorizationPolicy } from "../../domain/services.ts";
import { PermissionPresenter, RolePresenter } from "../dto.ts";
import { RoleAssigned } from "../../domain/events.ts";

export class ListPermissionsUseCase extends BaseUseCase<void, Record<string, unknown>> {
  constructor(private readonly catalog: PermissionCatalog) {
    super();
  }
  protected override get permission(): string | null {
    return "iam.permission.read";
  }
  protected override async handle(): Promise<Record<string, unknown>> {
    return PermissionPresenter.toDto(await this.catalog.list());
  }
}

export class ListRolesUseCase extends BaseUseCase<void, Record<string, unknown>[]> {
  constructor(private readonly roles: RoleRepository) {
    super();
  }
  protected override get permission(): string | null {
    return "iam.role.read";
  }
  protected override async handle(
    _input: void,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>[]> {
    const roles = await this.roles.listVisible(ctx.requireTenantId());
    return roles.map((role) => RolePresenter.toDto(role));
  }
}

export interface CreateRoleInput {
  slug: string;
  name: string;
  description: string;
  permissions: string[];
}

export class CreateRoleUseCase extends BaseUseCase<CreateRoleInput, Record<string, unknown>> {
  constructor(
    private readonly roles: RoleRepository,
    private readonly policy: RoleAuthorizationPolicy,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "iam.role.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: CreateRoleInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();

    const existing = await this.roles.findBySlug(tenantId, input.slug);
    if (existing && !existing.isGlobal) {
      throw new ConflictError("Ja existe um papel com este slug neste tenant", {
        slug: input.slug,
      });
    }

    await this.policy.ensurePermissionsExist(input.permissions);
    this.policy.ensureNoEscalation(input.permissions, ctx.permissions, ctx.role === "owner");

    const role = Role.create({
      id: this.ids.generate(),
      tenantId,
      slug: input.slug,
      name: input.name,
      description: input.description,
      permissions: input.permissions,
      now: this.clock.now(),
    });

    const saved = await this.roles.insert(role);
    await this.events.publish(role.pullEvents());
    await this.audit.record({
      action: "role.created",
      resourceType: "role",
      resourceId: saved.id,
      metadata: { slug: saved.slug, permissions: saved.permissions.values },
    });
    return RolePresenter.toDto(saved);
  }
}

export interface UpdateRoleInput {
  slug: string;
  name?: string;
  description?: string;
  permissions?: string[];
}

export class UpdateRoleUseCase extends BaseUseCase<UpdateRoleInput, Record<string, unknown>> {
  constructor(
    private readonly roles: RoleRepository,
    private readonly policy: RoleAuthorizationPolicy,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "iam.role.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: UpdateRoleInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();
    const role = await this.loadTenantRole(tenantId, input.slug);
    const now = this.clock.now();

    if (input.name !== undefined) role.rename(input.name, input.description, now);

    if (input.permissions !== undefined) {
      await this.policy.ensurePermissionsExist(input.permissions);
      this.policy.ensureNoEscalation(input.permissions, ctx.permissions, ctx.role === "owner");
      role.replacePermissions(input.permissions, now);
    }

    const saved = await this.roles.update(role);
    await this.events.publish(role.pullEvents());
    await this.audit.record({
      action: "role.updated",
      resourceType: "role",
      resourceId: saved.id,
      metadata: { slug: saved.slug },
    });
    return RolePresenter.toDto(saved);
  }

  private async loadTenantRole(tenantId: string, slug: string): Promise<Role> {
    const role = await this.roles.findBySlug(tenantId, slug);
    if (!role) throw new NotFoundError("Papel", slug);
    if (role.isGlobal) {
      throw new BusinessRuleError("Papeis de sistema nao podem ser alterados", { slug });
    }
    return role;
  }
}

export class DeleteRoleUseCase extends BaseUseCase<{ slug: string }, { deleted: string }> {
  constructor(
    private readonly roles: RoleRepository,
    private readonly policy: RoleAuthorizationPolicy,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "iam.role.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: { slug: string },
    ctx: RequestContext,
  ): Promise<{ deleted: string }> {
    const tenantId = ctx.requireTenantId();
    const role = await this.roles.findBySlug(tenantId, input.slug);
    if (!role || role.isGlobal) throw new NotFoundError("Papel", input.slug);

    role.ensureDeletable();
    await this.policy.ensureUnused(tenantId, input.slug);
    await this.roles.delete(role);

    await this.audit.record({
      action: "role.deleted",
      resourceType: "role",
      resourceId: role.id,
      metadata: { slug: input.slug },
    });
    return { deleted: input.slug };
  }
}

export interface AssignRoleInput {
  userId: string;
  role: string;
}

/** Atribui um papel a um membro, pela porta MembershipAssignments. */
export class AssignRoleUseCase extends BaseUseCase<AssignRoleInput, Record<string, unknown>> {
  constructor(
    private readonly roles: RoleRepository,
    private readonly assignments: MembershipAssignments,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "iam.role.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: AssignRoleInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();

    const role = await this.roles.findBySlug(tenantId, input.role);
    if (!role) throw new NotFoundError("Papel", input.role);

    // Atribuir "owner" e privilegio de quem ja e dono.
    if (role.slug === "owner" && ctx.role !== "owner") {
      throw new BusinessRuleError("Somente um dono pode nomear outro dono");
    }

    const previous = await this.assignments.currentRole(tenantId, input.userId);
    if (previous === null) throw new NotFoundError("Membro", input.userId);

    await this.assignments.assign(tenantId, input.userId, role.slug);
    await this.events.publish([new RoleAssigned(tenantId, input.userId, role.slug, previous)]);
    await this.audit.record({
      action: "role.assigned",
      resourceType: "membership",
      resourceId: input.userId,
      metadata: { role: role.slug, previous },
    });

    return { userId: input.userId, role: role.slug, previousRole: previous };
  }
}

/** Introspeccao: quem sou eu neste tenant e o que posso fazer. */
export class WhoAmIUseCase extends BaseUseCase<void, Record<string, unknown>> {
  protected override get permission(): string | null {
    return null;
  }

  protected override handle(
    _input: void,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    return Promise.resolve({
      actor: ctx.actor.toJSON(),
      tenantId: ctx.tenantId,
      tenantStatus: ctx.tenantStatus,
      isMember: ctx.isMember,
      role: ctx.role,
      permissions: ctx.permissions,
      requestId: ctx.requestId,
    });
  }
}

export interface ChangeRolePermissionsInput {
  slug: string;
  permissions: string[];
}

/**
 * Concede ou revoga permissoes de um papel do tenant, preservando o resto do
 * conjunto. Conceder passa pela regra de nao escalonamento; revogar nao,
 * porque tirar poder de um papel nunca aumenta o poder de quem pede.
 */
export class ChangeRolePermissionsUseCase
  extends BaseUseCase<ChangeRolePermissionsInput, Record<string, unknown>> {
  constructor(
    private readonly mode: "grant" | "revoke",
    private readonly roles: RoleRepository,
    private readonly policy: RoleAuthorizationPolicy,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "iam.role.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: ChangeRolePermissionsInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();
    const role = await this.roles.findBySlug(tenantId, input.slug);
    if (!role) throw new NotFoundError("Papel", input.slug);
    if (role.isGlobal) {
      throw new BusinessRuleError("Papeis de sistema nao podem ser alterados", {
        slug: input.slug,
      });
    }

    const now = this.clock.now();
    if (this.mode === "grant") {
      await this.policy.ensurePermissionsExist(input.permissions);
      this.policy.ensureNoEscalation(input.permissions, ctx.permissions, ctx.role === "owner");
      role.grant(input.permissions, now);
    } else {
      role.revoke(input.permissions, now);
    }

    const saved = await this.roles.update(role);
    await this.events.publish(role.pullEvents());
    await this.audit.record({
      action: `role.permissions_${this.mode}ed`,
      resourceType: "role",
      resourceId: saved.id,
      metadata: { slug: saved.slug, permissions: input.permissions },
    });
    return RolePresenter.toDto(saved);
  }
}
