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
import type { Invoice, Plan, Subscription } from "../../domain/entities.ts";
import type {
  InvoiceFilter,
  InvoiceRepository,
  PlanRepository,
  SubscriptionRepository,
  TenantUsageReader,
  UsageRecordInput,
  UsageRepository,
  UsageTotal,
} from "../../domain/ports.ts";
import type { UsageSnapshot } from "../../domain/value-objects.ts";
import {
  InvoiceLineMapper,
  InvoiceMapper,
  type InvoiceRow,
  PlanMapper,
  type PlanRow,
  SubscriptionMapper,
  type SubscriptionRow,
} from "./mappers.ts";

const LIVE_STATUSES = ["trialing", "active", "past_due"];
const SUBSCRIPTION_SELECT = "*, plan:plans(*)";

/** Catalogo global de planos: leitura para qualquer usuario autenticado. */
export class SupabasePlanRepository implements PlanRepository {
  private readonly mapper = new PlanMapper();

  constructor(private readonly billingClient: Db) {}

  async listActive(): Promise<Plan[]> {
    const { data, error } = await this.billingClient
      .from("plans")
      .select("*")
      .eq("is_active", true)
      .order("position");
    if (error) PostgrestErrorTranslator.translate(error, "Plano");
    return this.mapper.toDomainList((data ?? []) as unknown as PlanRow[]);
  }

  async getByCode(code: string): Promise<Plan> {
    const { data, error } = await this.billingClient
      .from("plans")
      .select("*")
      .eq("code", code)
      .maybeSingle();
    if (error) PostgrestErrorTranslator.translate(error, "Plano");
    if (!data) throw new NotFoundError("Plano", code);
    return this.mapper.toDomain(data as unknown as PlanRow);
  }

  async getById(id: string): Promise<Plan> {
    const { data, error } = await this.billingClient
      .from("plans")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) PostgrestErrorTranslator.translate(error, "Plano");
    if (!data) throw new NotFoundError("Plano", id);
    return this.mapper.toDomain(data as unknown as PlanRow);
  }
}

export class SupabaseSubscriptionRepository
  extends SupabaseRepository<Subscription, SubscriptionRow>
  implements SubscriptionRepository {
  private readonly subscriptionMapper = new SubscriptionMapper();

  constructor(client: Db, tenantId: string) {
    super(client, tenantId);
  }

  protected override get tableName(): string {
    return "subscriptions";
  }
  protected override get resourceName(): string {
    return "Assinatura";
  }
  protected override get mapper(): Mapper<Subscription, SubscriptionRow> {
    return this.subscriptionMapper;
  }

  async findLive(tenantId: string): Promise<Subscription | null> {
    const { data, error } = await this.table
      .select(SUBSCRIPTION_SELECT)
      .eq("tenant_id", tenantId)
      .in("status", LIVE_STATUSES)
      .maybeSingle();
    if (error) this.fail(error);
    return data ? this.subscriptionMapper.toDomain(data as unknown as SubscriptionRow) : null;
  }

  async getLive(tenantId: string): Promise<Subscription> {
    const found = await this.findLive(tenantId);
    if (!found) throw new NotFoundError("Assinatura vigente", tenantId);
    return found;
  }

  async history(tenantId: string, page: PageRequest): Promise<Page<Subscription>> {
    const { data, error, count } = await this.table
      .select(SUBSCRIPTION_SELECT, { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .range(page.offset, page.rangeEnd);
    if (error) this.fail(error);
    return new Page(
      this.subscriptionMapper.toDomainList((data ?? []) as unknown as SubscriptionRow[]),
      count ?? 0,
      page,
    );
  }

  override async insert(subscription: Subscription): Promise<Subscription> {
    const { error } = await this.table.insert(this.subscriptionMapper.toRow(subscription));
    if (error) this.fail(error);
    return await this.getLive(subscription.tenantId);
  }

  async save(subscription: Subscription): Promise<Subscription> {
    const { data, error } = await this.table
      .update(this.subscriptionMapper.toRow(subscription))
      .eq("tenant_id", subscription.tenantId)
      .eq("id", subscription.id)
      .select(SUBSCRIPTION_SELECT)
      .maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundError("Assinatura", subscription.id);
    return this.subscriptionMapper.toDomain(data as unknown as SubscriptionRow);
  }
}

export class SupabaseInvoiceRepository extends SupabaseRepository<Invoice, InvoiceRow>
  implements InvoiceRepository {
  private readonly invoiceMapper = new InvoiceMapper();

  constructor(
    client: Db,
    tenantId: string,
    private readonly serviceBillingClient: Db,
  ) {
    super(client, tenantId);
  }

  protected override get tableName(): string {
    return "invoices";
  }
  protected override get resourceName(): string {
    return "Fatura";
  }
  protected override get mapper(): Mapper<Invoice, InvoiceRow> {
    return this.invoiceMapper;
  }

  /** Numeracao sequencial por tenant, atomica no banco. */
  async nextNumber(tenantId: string): Promise<string> {
    const { data, error } = await this.serviceBillingClient.rpc("next_invoice_number", {
      p_tenant: tenantId,
    });
    if (error) throw new InfrastructureError(`Falha ao numerar a fatura: ${error.message}`);
    return data as string;
  }

  override async getById(id: string, withLines = true): Promise<Invoice> {
    const columns = withLines ? "*, invoice_lines(*)" : "*";
    const { data, error } = await this.scoped(columns).eq("id", id).maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundError("Fatura", id);
    return this.invoiceMapper.toDomain(data as unknown as InvoiceRow);
  }

  async search(filter: InvoiceFilter, page: PageRequest): Promise<Page<Invoice>> {
    let query = this.countingQuery();
    if (filter.status) query = query.eq("status", filter.status);
    if (filter.subscriptionId) query = query.eq("subscription_id", filter.subscriptionId);
    return await this.paginate(query, page);
  }

  override async insert(invoice: Invoice): Promise<Invoice> {
    const { error } = await this.table.insert(this.invoiceMapper.toRow(invoice));
    if (error) this.fail(error);
    await this.persistLines(invoice);
    return await this.getById(invoice.id);
  }

  async save(invoice: Invoice): Promise<Invoice> {
    const { data, error } = await this.table
      .update(this.invoiceMapper.toRow(invoice))
      .eq("tenant_id", this.tenantId)
      .eq("id", invoice.id)
      .select("id")
      .maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundError("Fatura", invoice.id);
    await this.persistLines(invoice);
    return await this.getById(invoice.id);
  }

  private async persistLines(invoice: Invoice): Promise<void> {
    const pending = invoice.pullNewLines();
    if (pending.length === 0) return;
    const lineMapper = new InvoiceLineMapper(invoice.currency);
    const { error } = await this.client
      .from("invoice_lines")
      .insert(pending.map((line) => lineMapper.toRow(line)));
    if (error) this.fail(error);
  }
}

export class SupabaseUsageRepository implements UsageRepository {
  constructor(private readonly billingClient: Db) {}

  async record(input: UsageRecordInput): Promise<void> {
    const { error } = await this.billingClient.from("usage_records").insert({
      id: input.id,
      tenant_id: input.tenantId,
      subscription_id: input.subscriptionId,
      metric: input.metric,
      quantity: input.quantity,
      recorded_at: input.recordedAt.toISOString(),
      idempotency_key: input.idempotencyKey,
      metadata: input.metadata,
      created_by: input.createdBy,
    });
    if (error) PostgrestErrorTranslator.translate(error, "Consumo");
  }

  /** Soma por metrica no periodo. A agregacao roda aqui, sobre poucas linhas. */
  async totals(tenantId: string, from: Date, to: Date): Promise<UsageTotal[]> {
    const { data, error } = await this.billingClient
      .from("usage_records")
      .select("metric, quantity")
      .eq("tenant_id", tenantId)
      .gte("recorded_at", from.toISOString())
      .lt("recorded_at", to.toISOString());
    if (error) PostgrestErrorTranslator.translate(error, "Consumo");

    const totals = new Map<string, UsageTotal>();
    for (const row of (data ?? []) as { metric: string; quantity: number }[]) {
      const current = totals.get(row.metric) ?? { metric: row.metric, quantity: 0, events: 0 };
      current.quantity += Number(row.quantity);
      current.events += 1;
      totals.set(row.metric, current);
    }
    return [...totals.values()].sort((a, b) => a.metric.localeCompare(b.metric));
  }
}

/**
 * Le o consumo estrutural do tenant (membros, projetos, negocios, contatos)
 * pela funcao billing.tenant_usage_snapshot.
 */
export class SupabaseTenantUsageReader implements TenantUsageReader {
  constructor(private readonly serviceBillingClient: Db) {}

  async snapshot(tenantId: string): Promise<UsageSnapshot> {
    const { data, error } = await this.serviceBillingClient.rpc("tenant_usage_snapshot", {
      p_tenant: tenantId,
    });
    if (error) throw new InfrastructureError(`Falha ao medir o consumo: ${error.message}`);
    const snapshot = (data ?? {}) as Record<string, unknown>;
    return {
      users: Number(snapshot.users ?? 0),
      projects: Number(snapshot.projects ?? 0),
      deals: Number(snapshot.deals ?? 0),
      contacts: Number(snapshot.contacts ?? 0),
    };
  }
}
