import {
  type Db,
  NotFoundError,
  Page,
  type PageRequest,
  PostgrestErrorTranslator,
} from "../../../_shared/mod.ts";
import type { Invitation, Membership, Tenant } from "../../domain/entities.ts";
import type {
  InvitationRepository,
  MembershipRepository,
  TenantMembershipView,
  TenantRepository,
} from "../../domain/ports.ts";
import {
  InvitationMapper,
  type InvitationRow,
  MembershipMapper,
  type MembershipRow,
  TenantMapper,
  type TenantRow,
} from "./mappers.ts";

/**
 * Os repositorios deste modulo derivam o escopo de tenant do argumento ou da
 * propria entidade, e nao de um tenant fixado na construcao. Tenancy e o unico
 * modulo que opera legitimamente fora de um tenant: ao criar um, e ao aceitar
 * um convite para outro.
 */
abstract class TenancyRepository {
  protected constructor(protected readonly client: Db) {}

  protected abstract get resourceName(): string;

  // deno-lint-ignore no-explicit-any
  protected fail(error: any): never {
    return PostgrestErrorTranslator.translate(error, this.resourceName);
  }
}

export class SupabaseTenantRepository extends TenancyRepository implements TenantRepository {
  private readonly mapper = new TenantMapper();

  constructor(client: Db) {
    super(client);
  }

  protected override get resourceName(): string {
    return "Tenant";
  }

  async findById(id: string): Promise<Tenant | null> {
    const { data, error } = await this.client.from("tenants").select("*").eq("id", id).maybeSingle();
    if (error) this.fail(error);
    return data ? this.mapper.toDomain(data as unknown as TenantRow) : null;
  }

  async getById(id: string): Promise<Tenant> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError("Tenant", id);
    return found;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const { data, error } = await this.client
      .from("tenants")
      .select("*")
      .ilike("slug", slug)
      .maybeSingle();
    if (error) this.fail(error);
    return data ? this.mapper.toDomain(data as unknown as TenantRow) : null;
  }

  async insert(tenant: Tenant): Promise<Tenant> {
    const { data, error } = await this.client
      .from("tenants")
      .insert(this.mapper.toRow(tenant))
      .select()
      .single();
    if (error) this.fail(error);
    return this.mapper.toDomain(data as unknown as TenantRow);
  }

  async update(tenant: Tenant): Promise<Tenant> {
    const { data, error } = await this.client
      .from("tenants")
      .update(this.mapper.toRow(tenant))
      .eq("id", tenant.id)
      .select()
      .maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundError("Tenant", tenant.id);
    return this.mapper.toDomain(data as unknown as TenantRow);
  }
}

export class SupabaseMembershipRepository extends TenancyRepository
  implements MembershipRepository {
  private readonly mapper = new MembershipMapper();

  constructor(client: Db) {
    super(client);
  }

  protected override get resourceName(): string {
    return "Membro";
  }

  async findById(id: string): Promise<Membership | null> {
    const { data, error } = await this.client
      .from("memberships")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) this.fail(error);
    return data ? this.mapper.toDomain(data as unknown as MembershipRow) : null;
  }

  async findByUser(tenantId: string, userId: string): Promise<Membership | null> {
    const { data, error } = await this.client
      .from("memberships")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) this.fail(error);
    return data ? this.mapper.toDomain(data as unknown as MembershipRow) : null;
  }

  async getByUser(tenantId: string, userId: string): Promise<Membership> {
    const found = await this.findByUser(tenantId, userId);
    if (!found) throw new NotFoundError("Membro", userId);
    return found;
  }

  async list(tenantId: string, page: PageRequest): Promise<Page<Membership>> {
    const { data, error, count } = await this.client
      .from("memberships")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order(page.sort ?? "created_at", { ascending: page.ascending })
      .range(page.offset, page.rangeEnd);
    if (error) this.fail(error);
    return new Page(
      this.mapper.toDomainList((data ?? []) as unknown as MembershipRow[]),
      count ?? 0,
      page,
    );
  }

  async countActiveOwners(tenantId: string): Promise<number> {
    const { count, error } = await this.client
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("role_slug", "owner")
      .eq("status", "active");
    if (error) this.fail(error);
    return count ?? 0;
  }

  /** Um join embutido do PostgREST evita a segunda consulta por tenant. */
  async listTenantsOf(userId: string): Promise<TenantMembershipView[]> {
    const tenantMapper = new TenantMapper();
    const { data, error } = await this.client
      .from("memberships")
      .select("role_slug, created_at, tenant:tenants(*)")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (error) this.fail(error);

    return ((data ?? []) as Record<string, unknown>[])
      .filter((row) => row.tenant)
      .map((row) => ({
        tenant: tenantMapper.toDomain(row.tenant as TenantRow),
        role: row.role_slug as string,
        joinedAt: new Date(row.created_at as string),
      }));
  }

  async insert(membership: Membership): Promise<Membership> {
    const { data, error } = await this.client
      .from("memberships")
      .insert(this.mapper.toRow(membership))
      .select()
      .single();
    if (error) this.fail(error);
    return this.mapper.toDomain(data as unknown as MembershipRow);
  }

  async update(membership: Membership): Promise<Membership> {
    const { data, error } = await this.client
      .from("memberships")
      .update(this.mapper.toRow(membership))
      .eq("id", membership.id)
      .select()
      .maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundError("Membro", membership.id);
    return this.mapper.toDomain(data as unknown as MembershipRow);
  }
}

export class SupabaseInvitationRepository extends TenancyRepository
  implements InvitationRepository {
  private readonly mapper = new InvitationMapper();

  constructor(client: Db) {
    super(client);
  }

  protected override get resourceName(): string {
    return "Convite";
  }

  async findById(id: string): Promise<Invitation | null> {
    const { data, error } = await this.client
      .from("invitations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) this.fail(error);
    return data ? this.mapper.toDomain(data as unknown as InvitationRow) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const { data, error } = await this.client
      .from("invitations")
      .select("*")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (error) this.fail(error);
    return data ? this.mapper.toDomain(data as unknown as InvitationRow) : null;
  }

  async findPendingByEmail(tenantId: string, email: string): Promise<Invitation | null> {
    const { data, error } = await this.client
      .from("invitations")
      .select("*")
      .eq("tenant_id", tenantId)
      .ilike("email", email)
      .eq("status", "pending")
      .maybeSingle();
    if (error) this.fail(error);
    return data ? this.mapper.toDomain(data as unknown as InvitationRow) : null;
  }

  async list(tenantId: string, page: PageRequest): Promise<Page<Invitation>> {
    const { data, error, count } = await this.client
      .from("invitations")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order(page.sort ?? "created_at", { ascending: page.ascending })
      .range(page.offset, page.rangeEnd);
    if (error) this.fail(error);
    return new Page(
      this.mapper.toDomainList((data ?? []) as unknown as InvitationRow[]),
      count ?? 0,
      page,
    );
  }

  async insert(invitation: Invitation): Promise<Invitation> {
    const { data, error } = await this.client
      .from("invitations")
      .insert(this.mapper.toRow(invitation))
      .select()
      .single();
    if (error) this.fail(error);
    return this.mapper.toDomain(data as unknown as InvitationRow);
  }

  async update(invitation: Invitation): Promise<Invitation> {
    const { data, error } = await this.client
      .from("invitations")
      .update(this.mapper.toRow(invitation))
      .eq("id", invitation.id)
      .select()
      .maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundError("Convite", invitation.id);
    return this.mapper.toDomain(data as unknown as InvitationRow);
  }
}
