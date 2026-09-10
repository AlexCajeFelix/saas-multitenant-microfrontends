import {
  type Db,
  InfrastructureError,
  Mapper,
  NotFoundError,
  type Page,
  type PageRequest,
  SupabaseRepository,
} from "../../../_shared/mod.ts";
import type { Company, Contact, Deal } from "../../domain/entities.ts";
import type {
  CompanyFilter,
  CompanyRepository,
  ContactFilter,
  ContactRepository,
  DealFilter,
  DealRepository,
  PipelineRepository,
  PipelineStageSummary,
} from "../../domain/ports.ts";
import { Pipeline } from "../../domain/value-objects.ts";
import {
  ActivityMapper,
  CompanyMapper,
  type CompanyRow,
  ContactMapper,
  type ContactRow,
  DealMapper,
  type DealRow,
  PipelineStageMapper,
  type PipelineStageRow,
} from "./mappers.ts";

/** Escapa o termo antes de montar o padrao do ilike. */
function likeTerm(search: string): string {
  return `%${search.replace(/[%_,()]/g, " ").trim()}%`;
}

export class SupabaseCompanyRepository extends SupabaseRepository<Company, CompanyRow>
  implements CompanyRepository {
  private readonly companyMapper = new CompanyMapper();

  constructor(client: Db, tenantId: string) {
    super(client, tenantId);
  }

  protected override get tableName(): string {
    return "companies";
  }
  protected override get resourceName(): string {
    return "Empresa";
  }
  protected override get mapper(): Mapper<Company, CompanyRow> {
    return this.companyMapper;
  }

  async search(filter: CompanyFilter, page: PageRequest): Promise<Page<Company>> {
    let query = this.countingQuery();
    if (filter.search) query = query.ilike("name", likeTerm(filter.search));
    if (filter.ownerId) query = query.eq("owner_id", filter.ownerId);
    return await this.paginate(query, page);
  }

  override async update(company: Company): Promise<Company> {
    return await super.update(company, company.id);
  }
}

export class SupabaseContactRepository extends SupabaseRepository<Contact, ContactRow>
  implements ContactRepository {
  private readonly contactMapper = new ContactMapper();

  constructor(client: Db, tenantId: string) {
    super(client, tenantId);
  }

  protected override get tableName(): string {
    return "contacts";
  }
  protected override get resourceName(): string {
    return "Contato";
  }
  protected override get mapper(): Mapper<Contact, ContactRow> {
    return this.contactMapper;
  }

  async search(filter: ContactFilter, page: PageRequest): Promise<Page<Contact>> {
    let query = this.countingQuery();
    if (filter.search) {
      const term = likeTerm(filter.search);
      query = query.or(
        `first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term}`,
      );
    }
    if (filter.companyId) query = query.eq("company_id", filter.companyId);
    if (filter.ownerId) query = query.eq("owner_id", filter.ownerId);
    return await this.paginate(query, page);
  }

  override async update(contact: Contact): Promise<Contact> {
    return await super.update(contact, contact.id);
  }
}

/**
 * Repositorio do agregado Deal. `save` grava a raiz e as atividades novas na
 * mesma operacao, para que quem chama nunca precise conhecer a tabela filha.
 */
export class SupabaseDealRepository extends SupabaseRepository<Deal, DealRow>
  implements DealRepository {
  private readonly dealMapper = new DealMapper();
  private readonly activityMapper = new ActivityMapper();

  constructor(client: Db, tenantId: string) {
    super(client, tenantId);
  }

  protected override get tableName(): string {
    return "deals";
  }
  protected override get resourceName(): string {
    return "Negocio";
  }
  protected override get mapper(): Mapper<Deal, DealRow> {
    return this.dealMapper;
  }

  override async getById(id: string, withActivities = false): Promise<Deal> {
    const columns = withActivities ? "*, activities(*)" : "*";
    const { data, error } = await this.scoped(columns).eq("id", id).maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundError("Negocio", id);
    return this.dealMapper.toDomain(data as unknown as DealRow);
  }

  async search(filter: DealFilter, page: PageRequest): Promise<Page<Deal>> {
    let query = this.countingQuery();
    if (filter.status) query = query.eq("status", filter.status);
    if (filter.stageKey) query = query.eq("stage_key", filter.stageKey);
    if (filter.companyId) query = query.eq("company_id", filter.companyId);
    if (filter.ownerId) query = query.eq("owner_id", filter.ownerId);
    if (filter.search) query = query.ilike("title", likeTerm(filter.search));
    return await this.paginate(query, page);
  }

  async save(deal: Deal): Promise<Deal> {
    const saved = await super.update(deal, deal.id);
    const pending = deal.pullNewActivities();
    if (pending.length > 0) {
      const { error } = await this.client
        .from("activities")
        .insert(pending.map((activity) => this.activityMapper.toRow(activity)));
      if (error) this.fail(error);
    }
    return saved;
  }
}

/** Funil configurado pelo tenant, mais o resumo agregado por estagio. */
export class SupabasePipelineRepository implements PipelineRepository {
  private readonly stageMapper = new PipelineStageMapper();

  constructor(private readonly crmClient: Db) {}

  async load(tenantId: string): Promise<Pipeline> {
    const { data, error } = await this.crmClient
      .from("pipeline_stages")
      .select("key, name, position, probability, is_won, is_lost")
      .eq("tenant_id", tenantId)
      .order("position");
    if (error) throw new InfrastructureError(`Falha ao carregar o funil: ${error.message}`);
    return Pipeline.from(
      this.stageMapper.toDomainList((data ?? []) as unknown as PipelineStageRow[]),
    );
  }

  async summary(tenantId: string): Promise<PipelineStageSummary[]> {
    const { data, error } = await this.crmClient.rpc("pipeline_summary", { p_tenant: tenantId });
    if (error) throw new InfrastructureError(`Falha ao resumir o funil: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      stageKey: row.stage_key as string,
      stageName: row.stage_name as string,
      position: Number(row.stage_position),
      dealsCount: Number(row.deals_count),
      totalCents: Number(row.total_cents),
      weightedCents: Number(row.weighted_cents),
    }));
  }
}
