import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { RequestContext } from "../application/context.ts";
import { Page, PageRequest } from "../application/ports.ts";
import {
  ConflictError,
  ForbiddenError,
  InfrastructureError,
  NotFoundError,
  ValidationError,
} from "../domain/errors.ts";

export type Db = SupabaseClient<any, any, any>;

/** Formato do erro que o PostgREST devolve. */
export interface PostgrestFailure {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Fabrica de clientes Supabase.
 *
 * `forActor` devolve um cliente que carrega o JWT do usuario e o header
 * x-tenant-id: e por ele que as consultas passam, para que a RLS do Postgres
 * seja realmente exercida. `asService` devolve o cliente administrativo, que
 * fura a RLS e por isso so aparece nas poucas operacoes que precisam disso.
 */
export class SupabaseConnection {
  private readonly serviceClients = new Map<string, Db>();
  private readonly actorClients = new WeakMap<RequestContext, Map<string, Db>>();

  private constructor(
    private readonly url: string,
    private readonly anonKey: string,
    private readonly serviceKey: string,
  ) {}

  static fromEnv(): SupabaseConnection {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) {
      throw new InfrastructureError(
        "SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios",
      );
    }
    return new SupabaseConnection(url, anonKey, serviceKey);
  }

  asService(schema = "public"): Db {
    const cached = this.serviceClients.get(schema);
    if (cached) return cached;
    const client = createClient(this.url, this.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema },
      global: { headers: { "x-client-info": "saas-multitenant/service" } },
    }) as Db;
    this.serviceClients.set(schema, client);
    return client;
  }

  forActor(ctx: RequestContext, schema = "public"): Db {
    if (!ctx.accessToken || ctx.actor.isService) {
      return this.asService(schema);
    }
    let perSchema = this.actorClients.get(ctx);
    if (!perSchema) {
      perSchema = new Map();
      this.actorClients.set(ctx, perSchema);
    }
    const cached = perSchema.get(schema);
    if (cached) return cached;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${ctx.accessToken}`,
      "x-client-info": "saas-multitenant/user",
    };
    if (ctx.tenantId) headers["x-tenant-id"] = ctx.tenantId;

    const client = createClient(this.url, this.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema },
      global: { headers },
    }) as Db;
    perSchema.set(schema, client);
    return client;
  }
}

/** Traduz o erro do PostgREST para o vocabulario do dominio. */
export class PostgrestErrorTranslator {
  static translate(error: PostgrestFailure, resource: string): never {
    const code = error.code ?? "";
    const detail = { resource, pgCode: code, detail: error.details ?? undefined };

    switch (code) {
      case "23505":
        throw new ConflictError(`Ja existe um registro de ${resource} com estes dados`, detail);
      case "23503":
        throw new ValidationError(`Referencia inexistente ao gravar ${resource}`, detail);
      case "23514":
      case "22P02":
      case "22001":
        throw new ValidationError(`Valor invalido para ${resource}: ${error.message}`, detail);
      case "42501":
        throw new ForbiddenError(
          `Sem permissao para esta operacao em ${resource}`,
          detail,
        );
      case "PGRST116":
        throw new NotFoundError(resource);
      default:
        if (/row-level security/i.test(error.message)) {
          throw new ForbiddenError(`Sem permissao para esta operacao em ${resource}`, detail);
        }
        throw new InfrastructureError(`Falha ao acessar ${resource}: ${error.message}`, detail);
    }
  }
}

/** Traducao entre o agregado e a linha da tabela. Um por tabela. */
export abstract class Mapper<TDomain, TRow extends Record<string, unknown>> {
  abstract toDomain(row: TRow): TDomain;
  abstract toRow(entity: TDomain): Record<string, unknown>;

  toDomainList(rows: readonly TRow[]): TDomain[] {
    return rows.map((row) => this.toDomain(row));
  }
}

/**
 * Adaptador de persistencia. Concentra o escopo de tenant, a paginacao e a
 * traducao de erros, para que cada repositorio concreto trate apenas do que
 * e proprio do seu agregado.
 */
export abstract class SupabaseRepository<
  TDomain,
  TRow extends Record<string, unknown>,
> {
  protected constructor(
    protected readonly client: Db,
    protected readonly tenantId: string,
  ) {}

  protected abstract get tableName(): string;
  protected abstract get resourceName(): string;
  protected abstract get mapper(): Mapper<TDomain, TRow>;

  /** Coluna que carrega o tenant. `core.tenants` usa a propria chave. */
  protected get tenantColumn(): string {
    return "tenant_id";
  }

  protected get table() {
    return this.client.from(this.tableName);
  }

  protected fail(error: PostgrestFailure): never {
    return PostgrestErrorTranslator.translate(error, this.resourceName);
  }

  protected scoped(columns = "*") {
    return this.table.select(columns).eq(this.tenantColumn, this.tenantId);
  }

  async findById(id: string): Promise<TDomain | null> {
    const { data, error } = await this.scoped().eq("id", id).maybeSingle();
    if (error) this.fail(error);
    return data ? this.mapper.toDomain(data as unknown as TRow) : null;
  }

  async getById(id: string): Promise<TDomain> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError(this.resourceName, id);
    return found;
  }

  async exists(id: string): Promise<boolean> {
    const { count, error } = await this.table
      .select("id", { count: "exact", head: true })
      .eq(this.tenantColumn, this.tenantId)
      .eq("id", id);
    if (error) this.fail(error);
    return (count ?? 0) > 0;
  }

  async insert(entity: TDomain): Promise<TDomain> {
    const { data, error } = await this.table
      .insert(this.mapper.toRow(entity))
      .select()
      .single();
    if (error) this.fail(error);
    return this.mapper.toDomain(data as unknown as TRow);
  }

  async insertMany(entities: readonly TDomain[]): Promise<TDomain[]> {
    if (entities.length === 0) return [];
    const { data, error } = await this.table
      .insert(entities.map((entity) => this.mapper.toRow(entity)))
      .select();
    if (error) this.fail(error);
    return this.mapper.toDomainList((data ?? []) as unknown as TRow[]);
  }

  /** Grava o estado corrente do agregado. Sem linha afetada, e 404. */
  async update(entity: TDomain, id: string): Promise<TDomain> {
    const { data, error } = await this.table
      .update(this.mapper.toRow(entity))
      .eq(this.tenantColumn, this.tenantId)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundError(this.resourceName, id);
    return this.mapper.toDomain(data as unknown as TRow);
  }

  async deleteById(id: string): Promise<void> {
    const { error, count } = await this.table
      .delete({ count: "exact" })
      .eq(this.tenantColumn, this.tenantId)
      .eq("id", id);
    if (error) this.fail(error);
    if ((count ?? 0) === 0) throw new NotFoundError(this.resourceName, id);
  }

  /**
   * Pagina um builder ja filtrado. O total vem do header Content-Range do
   * PostgREST, entao nao precisamos de uma segunda consulta.
   */
  protected async paginate(
    // deno-lint-ignore no-explicit-any
    builder: any,
    request: PageRequest,
    sortColumn = "created_at",
  ): Promise<Page<TDomain>> {
    const column = request.sort ?? sortColumn;
    const { data, error, count } = await builder
      .order(column, { ascending: request.ascending })
      .range(request.offset, request.rangeEnd);
    if (error) this.fail(error);
    return new Page(this.mapper.toDomainList((data ?? []) as unknown as TRow[]), count ?? 0, request);
  }

  /** Ponto de partida das listagens: ja conta e ja aplica o escopo de tenant. */
  protected countingQuery(columns = "*") {
    return this.table.select(columns, { count: "exact" }).eq(this.tenantColumn, this.tenantId);
  }
}
