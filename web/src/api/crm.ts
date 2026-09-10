import { api, fn, type Page } from "../lib/http";
import type { ListParams } from "./params";
import type {
  Activity,
  ActivityKind,
  Company,
  Contact,
  Deal,
  DealStatus,
  Deleted,
  Pipeline,
} from "./types";

const path = (route: string) => fn("crm", route);

export interface CompanyInput {
  name: string;
  domain?: string;
  industry?: string;
  size?: string;
  website?: string;
  phone?: string;
  ownerId?: string;
}

export interface ContactInput {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  companyId?: string;
  ownerId?: string;
}

export interface DealInput {
  title: string;
  stageKey?: string;
  companyId?: string;
  contactId?: string;
  amountCents?: number;
  currency?: string;
  expectedCloseDate?: string;
  ownerId?: string;
}

export const crmApi = {
  pipeline: () => api.get<Pipeline>(path("/pipeline")),

  listCompanies: (params: ListParams & { search?: string; ownerId?: string } = {}) =>
    api.get<Page<Company>>(path("/companies"), { ...params }),
  getCompany: (id: string) => api.get<Company>(path(`/companies/${id}`)),
  createCompany: (body: CompanyInput) => api.post<Company>(path("/companies"), body),
  updateCompany: (id: string, body: Partial<CompanyInput>) =>
    api.patch<Company>(path(`/companies/${id}`), body),
  deleteCompany: (id: string) => api.delete<Deleted>(path(`/companies/${id}`)),

  listContacts: (params: ListParams & { search?: string; companyId?: string } = {}) =>
    api.get<Page<Contact>>(path("/contacts"), { ...params }),
  getContact: (id: string) => api.get<Contact>(path(`/contacts/${id}`)),
  createContact: (body: ContactInput) => api.post<Contact>(path("/contacts"), body),
  updateContact: (id: string, body: Partial<ContactInput>) =>
    api.patch<Contact>(path(`/contacts/${id}`), body),
  deleteContact: (id: string) => api.delete<Deleted>(path(`/contacts/${id}`)),

  listDeals: (
    params: ListParams & {
      status?: DealStatus;
      stageKey?: string;
      companyId?: string;
      search?: string;
    } = {},
  ) => api.get<Page<Deal>>(path("/deals"), { ...params }),
  getDeal: (id: string) => api.get<Deal>(path(`/deals/${id}`)),
  createDeal: (body: DealInput) => api.post<Deal>(path("/deals"), body),
  updateDeal: (id: string, body: Partial<Omit<DealInput, "stageKey">>) =>
    api.patch<Deal>(path(`/deals/${id}`), body),

  /** Mover de estagio faz o negocio adotar a probabilidade do estagio de destino. */
  moveDeal: (id: string, stageKey: string) =>
    api.post<Deal>(path(`/deals/${id}/stage`), { stageKey }),
  winDeal: (id: string) => api.post<Deal>(path(`/deals/${id}/win`)),
  loseDeal: (id: string, reason: string) => api.post<Deal>(path(`/deals/${id}/lose`), { reason }),

  logActivity: (
    dealId: string,
    body: { kind: ActivityKind; subject: string; notes?: string; occurredAt?: string },
  ) => api.post<Activity>(path(`/deals/${dealId}/activities`), body),
};
