import {
  type AuditTrail,
  type Clock,
  type EventPublisher,
  type IdGenerator,
  type Logger,
  type ModuleRuntime,
  OutboxEventPublisher,
  type RequestContext,
  SupabaseAuditTrail,
} from "../_shared/mod.ts";
import type {
  CompanyRepository,
  ContactRepository,
  DealRepository,
  PipelineRepository,
} from "./domain/ports.ts";
import {
  SupabaseCompanyRepository,
  SupabaseContactRepository,
  SupabaseDealRepository,
  SupabasePipelineRepository,
} from "./infrastructure/persistence/repositories.ts";
import {
  CreateCompanyUseCase,
  CreateContactUseCase,
  DeleteCompanyUseCase,
  DeleteContactUseCase,
  GetCompanyUseCase,
  GetContactUseCase,
  ListCompaniesUseCase,
  ListContactsUseCase,
  UpdateCompanyUseCase,
  UpdateContactUseCase,
} from "./application/use-cases/companies.ts";
import {
  CloseDealUseCase,
  CreateDealUseCase,
  GetDealUseCase,
  GetPipelineUseCase,
  ListDealsUseCase,
  LogActivityUseCase,
  MoveDealStageUseCase,
  UpdateDealUseCase,
} from "./application/use-cases/deals.ts";

/** Raiz de composicao do modulo crm. */
export class CrmContainer {
  private readonly cache = new Map<string, unknown>();

  private constructor(
    readonly ctx: RequestContext,
    private readonly runtime: ModuleRuntime,
  ) {}

  static create(ctx: RequestContext, runtime: ModuleRuntime): CrmContainer {
    return new CrmContainer(ctx, runtime);
  }

  private lazy<T>(key: string, factory: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, factory());
    return this.cache.get(key) as T;
  }

  private get tenantId(): string {
    return this.ctx.tenantId ?? "";
  }
  private get crmClient() {
    return this.runtime.connection.forActor(this.ctx, "crm");
  }

  get logger(): Logger {
    return this.lazy(
      "logger",
      () =>
        this.runtime.logger.child({ requestId: this.ctx.requestId, tenantId: this.ctx.tenantId }),
    );
  }
  get clock(): Clock {
    return this.runtime.clock;
  }
  get ids(): IdGenerator {
    return this.runtime.ids;
  }
  get events(): EventPublisher {
    return this.lazy(
      "events",
      () => new OutboxEventPublisher(this.runtime.connection.asService("core"), this.logger),
    );
  }
  get audit(): AuditTrail {
    return this.lazy(
      "audit",
      () =>
        new SupabaseAuditTrail(this.runtime.connection.asService("core"), this.ctx, this.logger),
    );
  }

  get companies(): CompanyRepository {
    return this.lazy(
      "companies",
      () => new SupabaseCompanyRepository(this.crmClient, this.tenantId),
    );
  }
  get contacts(): ContactRepository {
    return this.lazy(
      "contacts",
      () => new SupabaseContactRepository(this.crmClient, this.tenantId),
    );
  }
  get deals(): DealRepository {
    return this.lazy("deals", () => new SupabaseDealRepository(this.crmClient, this.tenantId));
  }
  get pipelines(): PipelineRepository {
    return this.lazy("pipelines", () => new SupabasePipelineRepository(this.crmClient));
  }

  get createCompany(): CreateCompanyUseCase {
    return this.lazy(
      "createCompany",
      () => new CreateCompanyUseCase(this.companies, this.ids, this.clock, this.events, this.audit),
    );
  }
  get listCompanies(): ListCompaniesUseCase {
    return this.lazy("listCompanies", () => new ListCompaniesUseCase(this.companies));
  }
  get getCompany(): GetCompanyUseCase {
    return this.lazy("getCompany", () => new GetCompanyUseCase(this.companies));
  }
  get updateCompany(): UpdateCompanyUseCase {
    return this.lazy(
      "updateCompany",
      () => new UpdateCompanyUseCase(this.companies, this.clock, this.audit),
    );
  }
  get deleteCompany(): DeleteCompanyUseCase {
    return this.lazy("deleteCompany", () => new DeleteCompanyUseCase(this.companies, this.audit));
  }

  get createContact(): CreateContactUseCase {
    return this.lazy(
      "createContact",
      () =>
        new CreateContactUseCase(
          this.contacts,
          this.companies,
          this.ids,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get listContacts(): ListContactsUseCase {
    return this.lazy("listContacts", () => new ListContactsUseCase(this.contacts));
  }
  get getContact(): GetContactUseCase {
    return this.lazy("getContact", () => new GetContactUseCase(this.contacts));
  }
  get updateContact(): UpdateContactUseCase {
    return this.lazy(
      "updateContact",
      () => new UpdateContactUseCase(this.contacts, this.clock, this.audit),
    );
  }
  get deleteContact(): DeleteContactUseCase {
    return this.lazy("deleteContact", () => new DeleteContactUseCase(this.contacts, this.audit));
  }

  get createDeal(): CreateDealUseCase {
    return this.lazy(
      "createDeal",
      () =>
        new CreateDealUseCase(
          this.deals,
          this.pipelines,
          this.companies,
          this.contacts,
          this.ids,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get listDeals(): ListDealsUseCase {
    return this.lazy("listDeals", () => new ListDealsUseCase(this.deals));
  }
  get getDeal(): GetDealUseCase {
    return this.lazy("getDeal", () => new GetDealUseCase(this.deals));
  }
  get updateDeal(): UpdateDealUseCase {
    return this.lazy(
      "updateDeal",
      () => new UpdateDealUseCase(this.deals, this.clock, this.audit),
    );
  }
  get moveDeal(): MoveDealStageUseCase {
    return this.lazy(
      "moveDeal",
      () =>
        new MoveDealStageUseCase(
          this.deals,
          this.pipelines,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get winDeal(): CloseDealUseCase {
    return this.lazy(
      "winDeal",
      () =>
        new CloseDealUseCase(
          "won",
          this.deals,
          this.pipelines,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get loseDeal(): CloseDealUseCase {
    return this.lazy(
      "loseDeal",
      () =>
        new CloseDealUseCase(
          "lost",
          this.deals,
          this.pipelines,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get logActivity(): LogActivityUseCase {
    return this.lazy(
      "logActivity",
      () => new LogActivityUseCase(this.deals, this.ids, this.clock, this.events, this.audit),
    );
  }
  get getPipeline(): GetPipelineUseCase {
    return this.lazy("getPipeline", () => new GetPipelineUseCase(this.pipelines));
  }
}
