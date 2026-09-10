import { api, fn, type Page } from "../lib/http";
import type { ListParams } from "./params";
import type {
  ChangePlanResult,
  Invoice,
  InvoiceStatus,
  Plan,
  Subscription,
  SubscriptionView,
  UsageRecord,
  UsageReport,
} from "./types";

const path = (route: string) => fn("billing", route);

export const billingApi = {
  listPlans: () => api.get<Plan[]>(path("/plans")),

  currentSubscription: () => api.get<SubscriptionView>(path("/subscriptions/current")),
  subscribe: (planCode: string) => api.post<SubscriptionView>(path("/subscriptions"), { planCode }),

  /** Recusa a descida de plano quando o consumo atual nao cabe nos novos limites. */
  changePlan: (planCode: string) =>
    api.post<ChangePlanResult>(path("/subscriptions/change-plan"), { planCode }),
  cancel: (atPeriodEnd: boolean) =>
    api.post<Subscription>(path("/subscriptions/cancel"), { atPeriodEnd }),

  usage: () => api.get<UsageReport>(path("/usage")),
  recordUsage: (body: { metric: string; quantity: number; recordedAt?: string }) =>
    api.post<UsageRecord>(path("/usage"), body),

  listInvoices: (params: ListParams & { status?: InvoiceStatus } = {}) =>
    api.get<Page<Invoice>>(path("/invoices"), { ...params }),
  getInvoice: (id: string) => api.get<Invoice>(path(`/invoices/${id}`)),
  issueInvoice: (body: { dueInDays?: number; taxCents?: number; includeUsage?: boolean }) =>
    api.post<Invoice>(path("/invoices"), body),
  payInvoice: (id: string) => api.post<Invoice>(path(`/invoices/${id}/pay`)),
  voidInvoice: (id: string) => api.post<Invoice>(path(`/invoices/${id}/void`)),
};
