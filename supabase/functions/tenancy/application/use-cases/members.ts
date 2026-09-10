import {
  BaseUseCase,
  type AuditTrail,
  type Clock,
  type EventPublisher,
  type Page,
  type PageRequest,
  type RequestContext,
} from "../../../_shared/mod.ts";
import type { MembershipRepository } from "../../domain/ports.ts";
import type { MembershipPolicy } from "../../domain/services.ts";
import { MembershipPresenter } from "../dto.ts";

export class ListMembersUseCase extends BaseUseCase<PageRequest, Record<string, unknown>> {
  constructor(private readonly memberships: MembershipRepository) {
    super();
  }

  protected override get permission(): string | null {
    return "tenancy.member.read";
  }

  protected override async handle(
    page: PageRequest,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const result: Page<unknown> = (await this.memberships.list(ctx.requireTenantId(), page))
      .map((membership) => MembershipPresenter.toDto(membership));
    return result.toJSON();
  }
}

export interface ChangeMemberRoleInput {
  userId: string;
  role: string;
}

/**
 * Troca o papel de um membro. Duas regras de dominio entram aqui: o papel tem
 * de existir e o ultimo dono ativo nao pode ser rebaixado.
 */
export class ChangeMemberRoleUseCase
  extends BaseUseCase<ChangeMemberRoleInput, Record<string, unknown>> {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly policy: MembershipPolicy,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "tenancy.member.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: ChangeMemberRoleInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();
    const membership = await this.memberships.getByUser(tenantId, input.userId);

    await this.policy.ensureRoleExists(tenantId, input.role);
    if (membership.isOwner && input.role !== "owner") {
      await this.policy.ensureNotLastOwner(membership, "rebaixar este membro");
    }

    membership.changeRole(input.role, this.clock.now());
    const saved = await this.memberships.update(membership);

    await this.events.publish(membership.pullEvents());
    await this.audit.record({
      action: "member.role_changed",
      resourceType: "membership",
      resourceId: saved.id,
      metadata: { userId: input.userId, role: input.role },
    });
    return MembershipPresenter.toDto(saved);
  }
}

export class RemoveMemberUseCase extends BaseUseCase<{ userId: string }, Record<string, unknown>> {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly policy: MembershipPolicy,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "tenancy.member.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: { userId: string },
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const membership = await this.memberships.getByUser(ctx.requireTenantId(), input.userId);

    this.policy.ensureNotSelf(membership, ctx.requireUserId(), "remover");
    await this.policy.ensureNotLastOwner(membership, "remover este membro");

    membership.revoke(this.clock.now());
    const saved = await this.memberships.update(membership);

    await this.events.publish(membership.pullEvents());
    await this.audit.record({
      action: "member.removed",
      resourceType: "membership",
      resourceId: saved.id,
      metadata: { userId: input.userId },
    });
    return MembershipPresenter.toDto(saved);
  }
}
