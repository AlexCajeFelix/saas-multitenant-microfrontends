import type { Page, PageRequest } from "../../_shared/mod.ts";
import type { Invoice, Plan, Subscription } from "./entities.ts";
import type { UsageSnapshot } from "./value-objects.ts";

export interface PlanRepository {
  listActive(): Promise<Plan[]>;
  getByCode(code: string): Promise<Plan>;
  getById(id: string): Promise<Plan>;
}

export interface SubscriptionRepository {
  findLive(tenantId: string): Promise<Subscription | null>;
  getLive(tenantId: string): Promise<Subscription>;
  history(tenantId: string, page: PageRequest): Promise<Page<Subscription>>;
  insert(subscription: Subscription): Promise<Subscription>;
  save(subscription: Subscription): Promise<Subscription>;
}

export interface UsageRecordInput {
  id: string;
  tenantId: string;
  subscriptionId: string | null;
  metric: string;
  quantity: number;
  recordedAt: Date;
  idempotencyKey: string | null;
  metadata: Record<string, unknown>;
  createdBy: string | null;
}

export interface UsageTotal {
  metric: string;
  quantity: number;
  events: number;
}

export interface UsageRepository {
  record(input: UsageRecordInput): Promise<void>;
  totals(tenantId: string, from: Date, to: Date): Promise<UsageTotal[]>;
}

export interface InvoiceFilter {
  status?: string;
  subscriptionId?: string;
}

export interface InvoiceRepository {
  nextNumber(tenantId: string): Promise<string>;
  getById(id: string, withLines?: boolean): Promise<Invoice>;
  search(filter: InvoiceFilter, page: PageRequest): Promise<Page<Invoice>>;
  insert(invoice: Invoice): Promise<Invoice>;
  save(invoice: Invoice): Promise<Invoice>;
}

/**
 * Porta de leitura do consumo real do tenant. Os numeros vem de tabelas de
 * outros modulos, o que faz desta a unica leitura cruzada do sistema; ela e
 * isolada aqui para que a regra de limites nao dependa daqueles modulos.
 */
export interface TenantUsageReader {
  snapshot(tenantId: string): Promise<UsageSnapshot>;
}
