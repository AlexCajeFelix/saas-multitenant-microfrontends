import {
  type AuditTrail,
  BaseUseCase,
  type Clock,
  ConflictError,
  type EventPublisher,
  type IdGenerator,
  NotFoundError,
  type Page,
  type PageRequest,
  type RequestContext,
  type SecretHasher,
  UnauthorizedError,
} from "../../../_shared/mod.ts";
import { Invitation, Membership } from "../../domain/entities.ts";
import type { InvitationRepository, MembershipRepository } from "../../domain/ports.ts";
import type { MembershipPolicy } from "../../domain/services.ts";
import { InvitationPresenter, MembershipPresenter } from "../dto.ts";

export interface InviteMemberInput {
  email: string;
  role: string;
  validForDays: number;
}

/**
 * Emite um convite. O token em claro volta uma unica vez, nesta resposta; o
 * banco fica so com o hash. Em producao ele iria por e-mail em vez do corpo.
 */
export class InviteMemberUseCase extends BaseUseCase<InviteMemberInput, Record<string, unknown>> {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly memberships: MembershipRepository,
    private readonly policy: MembershipPolicy,
    private readonly hasher: SecretHasher,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "tenancy.invitation.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: InviteMemberInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();
    await this.policy.ensureRoleExists(tenantId, input.role);

    const pending = await this.invitations.findPendingByEmail(tenantId, input.email);
    if (pending) {
      throw new ConflictError("Ja existe um convite pendente para este e-mail", {
        email: input.email,
        invitationId: pending.id,
      });
    }

    const token = this.hasher.generateSecret(32);
    const invitation = Invitation.issue({
      id: this.ids.generate(),
      tenantId,
      email: input.email,
      role: input.role,
      tokenHash: await this.hasher.hash(token),
      invitedBy: ctx.requireUserId(),
      validForDays: input.validForDays,
      now: this.clock.now(),
    });

    const saved = await this.invitations.insert(invitation);
    await this.events.publish(invitation.pullEvents());
    await this.audit.record({
      action: "member.invited",
      resourceType: "invitation",
      resourceId: saved.id,
      metadata: { email: saved.email, role: saved.role.value },
    });

    return { ...InvitationPresenter.toDto(saved), token };
  }
}

export class ListInvitationsUseCase extends BaseUseCase<PageRequest, Record<string, unknown>> {
  constructor(private readonly invitations: InvitationRepository) {
    super();
  }

  protected override get permission(): string | null {
    return "tenancy.invitation.read";
  }

  protected override async handle(
    page: PageRequest,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const result: Page<unknown> = (await this.invitations.list(ctx.requireTenantId(), page))
      .map((invitation) => InvitationPresenter.toDto(invitation));
    return result.toJSON();
  }
}

export class RevokeInvitationUseCase
  extends BaseUseCase<{ invitationId: string }, Record<string, unknown>> {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "tenancy.invitation.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: { invitationId: string },
    _ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const invitation = await this.invitations.findById(input.invitationId);
    if (!invitation) throw new NotFoundError("Convite", input.invitationId);

    invitation.revoke();
    const saved = await this.invitations.update(invitation);
    await this.audit.record({
      action: "invitation.revoked",
      resourceType: "invitation",
      resourceId: saved.id,
    });
    return InvitationPresenter.toDto(saved);
  }
}

/**
 * Aceita um convite.
 *
 * Roda com a chave de servico e sem exigir x-tenant-id: quem aceita ainda nao
 * e membro de nada, entao nao ha contexto de tenant que a RLS possa avaliar.
 * O token e a credencial, e o agregado confere que o e-mail bate.
 */
export class AcceptInvitationUseCase
  extends BaseUseCase<{ token: string }, Record<string, unknown>> {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly memberships: MembershipRepository,
    private readonly hasher: SecretHasher,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return null;
  }

  protected override async handle(
    input: { token: string },
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const userId = ctx.requireUserId();
    const email = ctx.actor.email;
    if (!email) {
      throw new UnauthorizedError("O token de acesso nao traz o e-mail do usuario");
    }

    const invitation = await this.invitations.findByTokenHash(await this.hasher.hash(input.token));
    if (!invitation) throw new NotFoundError("Convite");

    const now = this.clock.now();
    invitation.accept(userId, email, now);

    const existing = await this.memberships.findByUser(invitation.tenantId, userId);
    let membership: Membership;
    if (existing) {
      existing.changeRole(invitation.role.value, now);
      membership = await this.memberships.update(existing);
    } else {
      membership = await this.memberships.insert(
        Membership.create({
          id: this.ids.generate(),
          tenantId: invitation.tenantId,
          userId,
          role: invitation.role.value,
          invitedBy: invitation.invitedBy,
          now,
        }),
      );
    }

    await this.invitations.update(invitation);
    await this.events.publish(invitation.pullEvents());
    await this.audit.record({
      action: "invitation.accepted",
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: { userId, tenantId: invitation.tenantId },
    });

    return {
      invitation: InvitationPresenter.toDto(invitation),
      membership: MembershipPresenter.toDto(membership),
    };
  }
}
