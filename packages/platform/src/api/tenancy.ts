import { api, fn, type Page } from "../lib/http";
import type { ListParams } from "./params";
import type {
  AcceptedInvitation,
  CreatedInvitation,
  Invitation,
  Membership,
  Tenant,
  TenantMembership,
} from "./types";

const path = (route: string) => fn("tenancy", route);

/**
 * Tres rotas correm antes de existir um tenant escolhido e recusam o cabecalho
 * `x-tenant-id`: listar os meus tenants, criar um e aceitar convite.
 */
export const tenancyApi = {
  listMyTenants: () => api.get<TenantMembership[]>(path("/tenants"), undefined, true),

  createTenant: (body: { name: string; slug?: string }) =>
    api.post<Tenant>(path("/tenants"), body, true),

  getTenant: (id: string) => api.get<Tenant>(path(`/tenants/${id}`)),

  // O slug e imutavel: o schema de atualizacao aceita apenas nome e ajustes.
  updateTenant: (id: string, body: { name?: string; settings?: Record<string, unknown> }) =>
    api.patch<Tenant>(path(`/tenants/${id}`), body),

  suspendTenant: (id: string) => api.post<Tenant>(path(`/tenants/${id}/suspend`)),
  activateTenant: (id: string) => api.post<Tenant>(path(`/tenants/${id}/activate`)),

  listMembers: (params: ListParams = {}) =>
    api.get<Page<Membership>>(path("/members"), { ...params }),

  changeMemberRole: (userId: string, role: string) =>
    api.patch<Membership>(path(`/members/${userId}`), { role }),

  removeMember: (userId: string) => api.delete<Membership>(path(`/members/${userId}`)),

  listInvitations: (params: ListParams = {}) =>
    api.get<Page<Invitation>>(path("/invitations"), { ...params }),

  invite: (body: { email: string; role?: string; validForDays?: number }) =>
    api.post<CreatedInvitation>(path("/invitations"), body),

  acceptInvitation: (token: string) =>
    api.post<AcceptedInvitation>(path("/invitations/accept"), { token }, true),

  revokeInvitation: (id: string) => api.delete<Invitation>(path(`/invitations/${id}`)),
};
