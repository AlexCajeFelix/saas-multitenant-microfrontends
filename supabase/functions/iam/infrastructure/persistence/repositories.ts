import {
  type Db,
  InfrastructureError,
  Mapper,
  NotFoundError,
  Page,
  type PageRequest,
  PostgrestErrorTranslator,
  SupabaseRepository,
} from "../../../_shared/mod.ts";
import type { ApiKey, Role } from "../../domain/entities.ts";
import type {
  ApiKeyRepository,
  MembershipAssignments,
  PermissionCatalog,
  PermissionDefinition,
  RoleRepository,
} from "../../domain/ports.ts";
import { ApiKeyMapper, type ApiKeyRow, RoleMapper, type RoleRow } from "./mappers.ts";

const ROLE_SELECT = "*, role_permissions(permission_slug)";

/**
 * Repositorio de papeis. As permissoes vem embutidas na mesma consulta e sao
 * gravadas pela funcao iam.replace_role_permissions, que troca o conjunto
 * inteiro dentro de uma transacao.
 */
export class SupabaseRoleRepository implements RoleRepository {
  private readonly mapper = new RoleMapper();

  constructor(
    private readonly iamClient: Db,
    private readonly serviceIamClient: Db,
  ) {}

  // deno-lint-ignore no-explicit-any
  private fail(error: any): never {
    return PostgrestErrorTranslator.translate(error, "Papel");
  }

  async findById(id: string): Promise<Role | null> {
    const { data, error } = await this.iamClient
      .from("roles")
      .select(ROLE_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) this.fail(error);
    return data ? this.mapper.toDomain(data as unknown as RoleRow) : null;
  }

  /** Papel do tenant tem precedencia sobre o papel de sistema de mesmo slug. */
  async findBySlug(tenantId: string, slug: string): Promise<Role | null> {
    const { data, error } = await this.iamClient
      .from("roles")
      .select(ROLE_SELECT)
      .ilike("slug", slug)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
    if (error) this.fail(error);

    const rows = (data ?? []) as unknown as RoleRow[];
    const preferred = rows.find((row) => row.tenant_id === tenantId) ?? rows[0];
    return preferred ? this.mapper.toDomain(preferred) : null;
  }

  async listVisible(tenantId: string): Promise<Role[]> {
    const { data, error } = await this.iamClient
      .from("roles")
      .select(ROLE_SELECT)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order("slug");
    if (error) this.fail(error);
    return this.mapper.toDomainList((data ?? []) as unknown as RoleRow[]);
  }

  async insert(role: Role): Promise<Role> {
    const { error } = await this.iamClient.from("roles").insert(this.mapper.toRow(role));
    if (error) this.fail(error);
    await this.replacePermissions(role);
    return await this.reload(role.id);
  }

  async update(role: Role): Promise<Role> {
    const { data, error } = await this.iamClient
      .from("roles")
      .update(this.mapper.toRow(role))
      .eq("id", role.id)
      .select("id")
      .maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundError("Papel", role.slug);
    await this.replacePermissions(role);
    return await this.reload(role.id);
  }

  async delete(role: Role): Promise<void> {
    const { error } = await this.iamClient.from("roles").delete().eq("id", role.id);
    if (error) this.fail(error);
  }

  async countMembersUsing(tenantId: string, slug: string): Promise<number> {
    const { data, error } = await this.serviceIamClient.rpc("count_members_using_role", {
      p_tenant: tenantId,
      p_role_slug: slug,
    });
    if (error) throw new InfrastructureError(`Falha ao contar membros: ${error.message}`);
    return (data as number | null) ?? 0;
  }

  private async replacePermissions(role: Role): Promise<void> {
    const { error } = await this.iamClient.rpc("replace_role_permissions", {
      p_role: role.id,
      p_permissions: role.permissions.values,
    });
    if (error) this.fail(error);
  }

  private async reload(id: string): Promise<Role> {
    const reloaded = await this.findById(id);
    if (!reloaded) throw new NotFoundError("Papel", id);
    return reloaded;
  }
}

export class SupabaseApiKeyRepository extends SupabaseRepository<ApiKey, ApiKeyRow>
  implements ApiKeyRepository {
  private readonly apiKeyMapper = new ApiKeyMapper();

  constructor(client: Db, tenantId: string) {
    super(client, tenantId);
  }

  protected override get tableName(): string {
    return "api_keys";
  }
  protected override get resourceName(): string {
    return "Chave de API";
  }
  protected override get mapper(): Mapper<ApiKey, ApiKeyRow> {
    return this.apiKeyMapper;
  }

  override async findById(id: string): Promise<ApiKey | null> {
    return await super.findById(id);
  }

  async list(_tenantId: string, page: PageRequest): Promise<Page<ApiKey>> {
    return await this.paginate(this.countingQuery(), page);
  }

  override async insert(key: ApiKey): Promise<ApiKey> {
    return await super.insert(key);
  }

  override async update(key: ApiKey): Promise<ApiKey> {
    return await super.update(key, key.id);
  }
}

/** Catalogo de permissoes: leitura pura sobre iam.permissions. */
export class SupabasePermissionCatalog implements PermissionCatalog {
  constructor(private readonly iamClient: Db) {}

  async list(): Promise<PermissionDefinition[]> {
    const { data, error } = await this.iamClient
      .from("permissions")
      .select("slug, module, description")
      .order("slug");
    if (error) throw new InfrastructureError(`Falha ao listar permissoes: ${error.message}`);
    return (data ?? []) as unknown as PermissionDefinition[];
  }

  async existingSlugs(slugs: readonly string[]): Promise<string[]> {
    if (slugs.length === 0) return [];
    const { data, error } = await this.iamClient
      .from("permissions")
      .select("slug")
      .in("slug", [...slugs]);
    if (error) throw new InfrastructureError(`Falha ao validar permissoes: ${error.message}`);
    return ((data ?? []) as { slug: string }[]).map((row) => row.slug);
  }
}

/**
 * Escrita no vinculo usuario/tenant, que e tabela do modulo tenancy. Passa
 * pela RLS com o JWT do chamador: quem nao tem tenancy.member.write nao grava.
 */
export class SupabaseMembershipAssignments implements MembershipAssignments {
  constructor(private readonly coreClient: Db) {}

  async currentRole(tenantId: string, userId: string): Promise<string | null> {
    const { data, error } = await this.coreClient
      .from("memberships")
      .select("role_slug")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (error) PostgrestErrorTranslator.translate(error, "Membro");
    return data ? (data.role_slug as string) : null;
  }

  async assign(tenantId: string, userId: string, roleSlug: string): Promise<void> {
    const { data, error } = await this.coreClient
      .from("memberships")
      .update({ role_slug: roleSlug })
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (error) PostgrestErrorTranslator.translate(error, "Membro");
    if (!data) throw new NotFoundError("Membro", userId);
  }
}
