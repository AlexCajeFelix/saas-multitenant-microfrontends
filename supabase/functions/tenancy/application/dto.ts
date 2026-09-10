import { V } from "../../_shared/mod.ts";
import type { Invitation, Membership, Tenant } from "../domain/entities.ts";
import type { TenantMembershipView } from "../domain/ports.ts";

export const CreateTenantSchema = V.schema({
  name: V.text(2, 120),
  slug: V.slug().optional(),
  settings: V.record().optional(),
});

export const UpdateTenantSchema = V.schema({
  id: V.uuid(),
  name: V.text(2, 120).optional(),
  settings: V.record().optional(),
});

export const TenantStatusChangeSchema = V.schema({
  id: V.uuid(),
  reason: V.text(3, 240).optional(),
});

export const InviteMemberSchema = V.schema({
  email: V.email(),
  role: V.string().lower().max(32).default("member"),
  validForDays: V.integer().min(1).max(30).default(7),
});

export const AcceptInvitationSchema = V.schema({
  token: V.string().min(32).max(128),
});

export const ChangeMemberRoleSchema = V.schema({
  userId: V.uuid(),
  role: V.string().lower().max(32),
});

export const MemberIdSchema = V.schema({ userId: V.uuid() });
export const InvitationIdSchema = V.schema({ invitationId: V.uuid() });

/** Traducao do agregado para o JSON da API. Fica na aplicacao, nao no dominio. */
export class TenantPresenter {
  static toDto(tenant: Tenant): Record<string, unknown> {
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status.value,
      settings: tenant.settings,
      createdBy: tenant.createdBy,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  }

  static toMembershipDto(view: TenantMembershipView): Record<string, unknown> {
    return {
      ...TenantPresenter.toDto(view.tenant),
      myRole: view.role,
      joinedAt: view.joinedAt.toISOString(),
    };
  }
}

export class MembershipPresenter {
  static toDto(membership: Membership): Record<string, unknown> {
    return {
      id: membership.id,
      tenantId: membership.tenantId,
      userId: membership.userId,
      role: membership.role.value,
      status: membership.status.value,
      invitedBy: membership.invitedBy,
      createdAt: membership.createdAt.toISOString(),
      updatedAt: membership.updatedAt.toISOString(),
    };
  }
}

export class InvitationPresenter {
  static toDto(invitation: Invitation): Record<string, unknown> {
    return {
      id: invitation.id,
      tenantId: invitation.tenantId,
      email: invitation.email,
      role: invitation.role.value,
      status: invitation.status.value,
      invitedBy: invitation.invitedBy,
      expiresAt: invitation.expiresAt.toISOString(),
      acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
      acceptedBy: invitation.acceptedBy,
      createdAt: invitation.createdAt.toISOString(),
    };
  }
}
