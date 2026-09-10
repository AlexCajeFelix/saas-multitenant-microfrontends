import { Mapper } from "../../../_shared/mod.ts";
import { ApiKey, Role } from "../../domain/entities.ts";
import { PermissionSet, RoleSlug } from "../../domain/value-objects.ts";

export interface RoleRow extends Record<string, unknown> {
  id: string;
  tenant_id: string | null;
  slug: string;
  name: string;
  description: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
  role_permissions?: { permission_slug: string }[] | null;
}

export class RoleMapper extends Mapper<Role, RoleRow> {
  override toDomain(row: RoleRow): Role {
    return Role.restore(row.id, {
      tenantId: row.tenant_id,
      slug: RoleSlug.create(row.slug),
      name: row.name,
      description: row.description ?? "",
      isSystem: row.is_system,
      permissions: PermissionSet.of(
        (row.role_permissions ?? []).map((entry) => entry.permission_slug),
      ),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  /** As permissoes vao por uma chamada propria; aqui so o cabecalho do papel. */
  override toRow(role: Role): Record<string, unknown> {
    return {
      id: role.id,
      tenant_id: role.scopeTenantId,
      slug: role.slug,
      name: role.name,
      description: role.description,
      is_system: role.isSystem,
    };
  }
}

export interface ApiKeyRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  scopes: string[] | null;
  created_by: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export class ApiKeyMapper extends Mapper<ApiKey, ApiKeyRow> {
  override toDomain(row: ApiKeyRow): ApiKey {
    return ApiKey.restore(row.id, {
      tenantId: row.tenant_id,
      name: row.name,
      prefix: row.prefix,
      keyHash: row.key_hash,
      scopes: row.scopes ?? [],
      createdBy: row.created_by,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  override toRow(key: ApiKey): Record<string, unknown> {
    return {
      id: key.id,
      tenant_id: key.tenantId,
      name: key.name,
      prefix: key.prefix,
      key_hash: key.keyHash,
      scopes: key.scopes,
      created_by: key.createdBy,
      last_used_at: key.lastUsedAt?.toISOString() ?? null,
      expires_at: key.expiresAt?.toISOString() ?? null,
      revoked_at: key.revokedAt?.toISOString() ?? null,
    };
  }
}
