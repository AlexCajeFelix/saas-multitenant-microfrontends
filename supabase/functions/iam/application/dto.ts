import { V } from "../../_shared/mod.ts";
import type { ApiKey, Role } from "../domain/entities.ts";
import type { PermissionDefinition } from "../domain/ports.ts";

const permissionList = V.array(
  V.string().lower().matching(/^[a-z]+\.[a-z_]+\.[a-z_]+$/, "modulo.recurso.acao"),
).max(200);

export const CreateRoleSchema = V.schema({
  slug: V.string().lower().matching(/^[a-z][a-z0-9_-]{1,30}$/, "slug de papel"),
  name: V.text(2, 80),
  description: V.string().max(240).default(""),
  permissions: permissionList.default([]),
});

export const UpdateRoleSchema = V.schema({
  slug: V.string().lower(),
  name: V.text(2, 80).optional(),
  description: V.string().max(240).optional(),
  permissions: permissionList.optional(),
});

export const RoleSlugSchema = V.schema({ slug: V.string().lower() });

export const RolePermissionsSchema = V.schema({
  slug: V.string().lower(),
  permissions: permissionList.min(1),
});

export const AssignRoleSchema = V.schema({
  userId: V.uuid(),
  role: V.string().lower(),
});

export const IssueApiKeySchema = V.schema({
  name: V.text(2, 80),
  scopes: permissionList.default([]),
  expiresInDays: V.integer().min(1).max(3650).optional(),
});

export const ApiKeyIdSchema = V.schema({ id: V.uuid() });

export class RolePresenter {
  static toDto(role: Role): Record<string, unknown> {
    return {
      id: role.id,
      tenantId: role.scopeTenantId,
      slug: role.slug,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      scope: role.isGlobal ? "system" : "tenant",
      permissions: role.permissions.values,
      permissionCount: role.permissions.size,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
    };
  }
}

export class ApiKeyPresenter {
  static toDto(key: ApiKey, now: Date): Record<string, unknown> {
    return {
      id: key.id,
      tenantId: key.tenantId,
      name: key.name,
      prefix: key.prefix,
      scopes: key.scopes,
      active: key.isActiveAt(now),
      createdBy: key.createdBy,
      lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
      expiresAt: key.expiresAt?.toISOString() ?? null,
      revokedAt: key.revokedAt?.toISOString() ?? null,
      createdAt: key.createdAt.toISOString(),
    };
  }
}

export class PermissionPresenter {
  /** Agrupa por modulo, que e como um painel de administracao mostraria. */
  static toDto(permissions: readonly PermissionDefinition[]): Record<string, unknown> {
    const byModule: Record<string, PermissionDefinition[]> = {};
    for (const permission of permissions) {
      (byModule[permission.module] ??= []).push(permission);
    }
    return {
      total: permissions.length,
      modules: Object.keys(byModule).sort().map((module) => ({
        module,
        permissions: byModule[module].map((entry) => ({
          slug: entry.slug,
          description: entry.description,
        })),
      })),
    };
  }
}
