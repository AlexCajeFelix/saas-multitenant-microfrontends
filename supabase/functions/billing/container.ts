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
  InvoiceRepository,
  PlanRepository,
  SubscriptionRepository,
  TenantUsageReader,
  UsageRepository,
} from "./domain/ports.ts";
import { PlanLimitPolicy } from "./domain/services.ts";
import {
  SupabaseInvoiceRepository,
  SupabasePlanRepository,
  SupabaseSubscriptionRepository,
  SupabaseTenantUsageReader,
  SupabaseUsageRepository,
} from "./infrastructure/persistence/repositories.ts";
import {
  CancelSubscriptionUseCase,
  ChangePlanUseCase,
  GetCurrentSubscriptionUseCase,
  GetUsageUseCase,
  ListPlansUseCase,
  RecordUsageUseCase,
  SubscribeUseCase,
} from "./application/use-cases/subscriptions.ts";
import {
  GetInvoiceUseCase,
  IssueInvoiceUseCase,
  ListInvoicesUseCase,
  PayInvoiceUseCase,
  VoidInvoiceUseCase,
} from "./application/use-cases/invoices.ts";

/** Raiz de composicao do modulo billing. */
export class BillingContainer {
  private readonly cache = new Map<string, unknown>();

  private constructor(
    readonly ctx: RequestContext,
    private readonly runtime: ModuleRuntime,
  ) {}

  static create(ctx: RequestContext, runtime: ModuleRuntime): BillingContainer {
    return new BillingContainer(ctx, runtime);
  }

  private lazy<T>(key: string, factory: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, factory());
    return this.cache.get(key) as T;
  }

  private get tenantId(): string {
    return this.ctx.tenantId ?? "";
  }
  private get billingClient() {
    return this.runtime.connection.forActor(this.ctx, "billing");
  }
  private get serviceBillingClient() {
    return this.runtime.connection.asService("billing");
  }

  get logger(): Logger {
    return this.lazy("logger", () =>
      this.runtime.logger.child({ requestId: this.ctx.requestId, tenantId: this.ctx.tenantId }));
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

  get plans(): PlanRepository {
    return this.lazy("plans", () => new SupabasePlanRepository(this.billingClient));
  }
  get subscriptions(): SubscriptionRepository {
    return this.lazy(
      "subscriptions",
      () => new SupabaseSubscriptionRepository(this.billingClient, this.tenantId),
    );
  }
  get invoices(): InvoiceRepository {
    return this.lazy(
      "invoices",
      () =>
        new SupabaseInvoiceRepository(
          this.billingClient,
          this.tenantId,
          this.serviceBillingClient,
        ),
    );
  }
  get usage(): UsageRepository {
    return this.lazy("usage", () => new SupabaseUsageRepository(this.billingClient));
  }
  get usageReader(): TenantUsageReader {
    return this.lazy(
      "usageReader",
      () => new SupabaseTenantUsageReader(this.serviceBillingClient),
    );
  }
  get limitPolicy(): PlanLimitPolicy {
    return this.lazy("limitPolicy", () => new PlanLimitPolicy(this.usageReader));
  }

  get listPlans(): ListPlansUseCase {
    return this.lazy("listPlans", () => new ListPlansUseCase(this.plans));
  }
  get subscribe(): SubscribeUseCase {
    return this.lazy(
      "subscribe",
      () =>
        new SubscribeUseCase(
          this.subscriptions,
          this.plans,
          this.limitPolicy,
          this.ids,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get currentSubscription(): GetCurrentSubscriptionUseCase {
    return this.lazy(
      "currentSubscription",
      () =>
        new GetCurrentSubscriptionUseCase(
          this.subscriptions,
          this.plans,
          this.limitPolicy,
          this.clock,
        ),
    );
  }
  get changePlan(): ChangePlanUseCase {
    return this.lazy(
      "changePlan",
      () =>
        new ChangePlanUseCase(
          this.subscriptions,
          this.plans,
          this.limitPolicy,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get cancelSubscription(): CancelSubscriptionUseCase {
    return this.lazy(
      "cancelSubscription",
      () =>
        new CancelSubscriptionUseCase(this.subscriptions, this.clock, this.events, this.audit),
    );
  }
  get recordUsage(): RecordUsageUseCase {
    return this.lazy(
      "recordUsage",
      () =>
        new RecordUsageUseCase(
          this.usage,
          this.subscriptions,
          this.ids,
          this.clock,
          this.events,
        ),
    );
  }
  get getUsage(): GetUsageUseCase {
    return this.lazy(
      "getUsage",
      () => new GetUsageUseCase(this.usage, this.subscriptions, this.clock),
    );
  }

  get issueInvoice(): IssueInvoiceUseCase {
    return this.lazy(
      "issueInvoice",
      () =>
        new IssueInvoiceUseCase(
          this.invoices,
          this.subscriptions,
          this.plans,
          this.usage,
          this.ids,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get listInvoices(): ListInvoicesUseCase {
    return this.lazy("listInvoices", () => new ListInvoicesUseCase(this.invoices));
  }
  get getInvoice(): GetInvoiceUseCase {
    return this.lazy("getInvoice", () => new GetInvoiceUseCase(this.invoices));
  }
  get payInvoice(): PayInvoiceUseCase {
    return this.lazy(
      "payInvoice",
      () => new PayInvoiceUseCase(this.invoices, this.clock, this.events, this.audit),
    );
  }
  get voidInvoice(): VoidInvoiceUseCase {
    return this.lazy(
      "voidInvoice",
      () => new VoidInvoiceUseCase(this.invoices, this.clock, this.audit),
    );
  }
}
