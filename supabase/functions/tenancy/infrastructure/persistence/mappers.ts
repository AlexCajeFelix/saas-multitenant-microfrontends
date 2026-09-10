import { Email, Mapper, Slug } from "../../../_shared/mod.ts";
import { Invitation, Membership, Tenant } from "../../domain/entities.ts";
import {
  InvitationStatus,
  InvitationToken,
  MemberRole,
  MembershipStatus,
  TenantStatus,
} from "../../domain/value-objects.ts";

export interface TenantRow extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  status: string;
  settings: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export class TenantMapper extends Mapper<Tenant, TenantRow> {
  override toDomain(row: TenantRow): Tenant {
    return Tenant.restore(row.id, {
      slug: Slug.create(row.slug),
      name: row.name,
      status: TenantStatus.create(row.status),
      settings: row.settings ?? {},
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  override toRow(tenant: Tenant): Record<string, unknown> {
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status.value,
      settings: tenant.settings,
      created_by: tenant.createdBy,
    };
  }
}

export interface MembershipRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  user_id: string;
  role_slug: string;
  status: string;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
}

export class MembershipMapper extends Mapper<Membership, MembershipRow> {
  override toDomain(row: MembershipRow): Membership {
    return Membership.restore(row.id, {
      tenantId: row.tenant_id,
      userId: row.user_id,
      role: MemberRole.create(row.role_slug),
      status: MembershipStatus.create(row.status),
      invitedBy: row.invited_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  override toRow(membership: Membership): Record<string, unknown> {
    return {
      id: membership.id,
      tenant_id: membership.tenantId,
      user_id: membership.userId,
      role_slug: membership.role.value,
      status: membership.status.value,
      invited_by: membership.invitedBy,
    };
  }
}

export interface InvitationRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  email: string;
  role_slug: string;
  token_hash: string;
  status: string;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  created_at: string;
}

export class InvitationMapper extends Mapper<Invitation, InvitationRow> {
  override toDomain(row: InvitationRow): Invitation {
    return Invitation.restore(row.id, {
      tenantId: row.tenant_id,
      email: Email.create(row.email),
      role: MemberRole.create(row.role_slug),
      token: InvitationToken.fromHash(row.token_hash),
      status: InvitationStatus.create(row.status),
      invitedBy: row.invited_by,
      expiresAt: new Date(row.expires_at),
      acceptedAt: row.accepted_at ? new Date(row.accepted_at) : null,
      acceptedBy: row.accepted_by,
      createdAt: new Date(row.created_at),
    });
  }

  override toRow(invitation: Invitation): Record<string, unknown> {
    return {
      id: invitation.id,
      tenant_id: invitation.tenantId,
      email: invitation.email,
      role_slug: invitation.role.value,
      token_hash: invitation.tokenHash,
      status: invitation.status.value,
      invited_by: invitation.invitedBy,
      expires_at: invitation.expiresAt.toISOString(),
      accepted_at: invitation.acceptedAt?.toISOString() ?? null,
      accepted_by: invitation.acceptedBy,
    };
  }
}
