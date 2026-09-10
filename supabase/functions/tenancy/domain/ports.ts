import type { Page, PageRequest } from "../../_shared/mod.ts";
import type { Invitation, Membership, Tenant } from "./entities.ts";

/** Projecao de leitura: o tenant visto por um de seus membros. */
export interface TenantMembershipView {
  tenant: Tenant;
  role: string;
  joinedAt: Date;
}

/** Porta de saida do agregado Tenant. */
export interface TenantRepository {
  findById(id: string): Promise<Tenant | null>;
  getById(id: string): Promise<Tenant>;
  findBySlug(slug: string): Promise<Tenant | null>;
  insert(tenant: Tenant): Promise<Tenant>;
  update(tenant: Tenant): Promise<Tenant>;
}

/** Porta de saida do agregado Membership. */
export interface MembershipRepository {
  findById(id: string): Promise<Membership | null>;
  findByUser(tenantId: string, userId: string): Promise<Membership | null>;
  getByUser(tenantId: string, userId: string): Promise<Membership>;
  list(tenantId: string, page: PageRequest): Promise<Page<Membership>>;
  countActiveOwners(tenantId: string): Promise<number>;
  listTenantsOf(userId: string): Promise<TenantMembershipView[]>;
  insert(membership: Membership): Promise<Membership>;
  update(membership: Membership): Promise<Membership>;
}

/** Porta de saida do agregado Invitation. */
export interface InvitationRepository {
  findById(id: string): Promise<Invitation | null>;
  findByTokenHash(tokenHash: string): Promise<Invitation | null>;
  findPendingByEmail(tenantId: string, email: string): Promise<Invitation | null>;
  list(tenantId: string, page: PageRequest): Promise<Page<Invitation>>;
  insert(invitation: Invitation): Promise<Invitation>;
  update(invitation: Invitation): Promise<Invitation>;
}

/**
 * Porta para o catalogo de papeis, que pertence ao modulo iam. Impede que este
 * modulo importe o dominio do outro: ele so faz a pergunta que precisa.
 */
export interface RoleCatalog {
  exists(tenantId: string, roleSlug: string): Promise<boolean>;
  listAvailable(tenantId: string): Promise<string[]>;
}

/**
 * Porta de provisionamento. Um tenant recem-criado precisa de funil de vendas
 * e de assinatura, que sao assunto dos modulos crm e billing.
 */
export interface TenantProvisioning {
  installDefaults(tenantId: string, ownerId: string): Promise<void>;
}
