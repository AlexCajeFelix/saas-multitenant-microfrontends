import type { Page, PageRequest } from "../../_shared/mod.ts";
import type { ApiKey, Role } from "./entities.ts";

export interface PermissionDefinition {
  slug: string;
  module: string;
  description: string;
}

/** Catalogo global de permissoes. Somente leitura. */
export interface PermissionCatalog {
  list(): Promise<PermissionDefinition[]>;
  existingSlugs(slugs: readonly string[]): Promise<string[]>;
}

export interface RoleRepository {
  findById(id: string): Promise<Role | null>;
  findBySlug(tenantId: string, slug: string): Promise<Role | null>;
  /** Papeis do tenant e papeis de sistema, nesta ordem de precedencia. */
  listVisible(tenantId: string): Promise<Role[]>;
  insert(role: Role): Promise<Role>;
  update(role: Role): Promise<Role>;
  delete(role: Role): Promise<void>;
  countMembersUsing(tenantId: string, slug: string): Promise<number>;
}

export interface ApiKeyRepository {
  findById(tenantId: string, id: string): Promise<ApiKey | null>;
  list(tenantId: string, page: PageRequest): Promise<Page<ApiKey>>;
  insert(key: ApiKey): Promise<ApiKey>;
  update(key: ApiKey): Promise<ApiKey>;
}

/**
 * Porta de escrita no vinculo usuario/tenant, que pertence ao modulo tenancy.
 * O iam so precisa trocar o papel de um membro, e e so isso que a porta expoe.
 */
export interface MembershipAssignments {
  currentRole(tenantId: string, userId: string): Promise<string | null>;
  assign(tenantId: string, userId: string, roleSlug: string): Promise<void>;
}
