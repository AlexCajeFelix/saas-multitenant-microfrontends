import { api, fn, type Page } from "../lib/http";
import type { ListParams } from "./params";
import type {
  ApiKey,
  CreatedApiKey,
  Deleted,
  PermissionCatalog,
  Role,
  RoleAssignment,
  WhoAmI,
} from "./types";

const path = (route: string) => fn("iam", route);

export const iamApi = {
  whoami: () => api.get<WhoAmI>(path("/whoami")),

  permissions: () => api.get<PermissionCatalog>(path("/permissions")),

  listRoles: () => api.get<Role[]>(path("/roles")),

  getRole: (slug: string) => api.get<Role>(path(`/roles/${slug}`)),

  createRole: (body: { slug: string; name: string; description?: string; permissions?: string[] }) =>
    api.post<Role>(path("/roles"), body),

  /**
   * Serve tambem para revogar permissao: manda-se o conjunto final inteiro.
   * A rota `DELETE /roles/:slug/permissions` responde 200 e nao revoga nada,
   * porque o backend nao le corpo em DELETE e a lista se perde no caminho.
   */
  updateRole: (
    slug: string,
    body: { name?: string; description?: string; permissions?: string[] },
  ) => api.patch<Role>(path(`/roles/${slug}`), body),

  grantPermissions: (slug: string, permissions: string[]) =>
    api.post<Role>(path(`/roles/${slug}/permissions`), { permissions }),

  deleteRole: (slug: string) => api.delete<Deleted>(path(`/roles/${slug}`)),

  assignRole: (userId: string, role: string) =>
    api.post<RoleAssignment>(path("/assignments"), { userId, role }),

  listApiKeys: (params: ListParams = {}) => api.get<Page<ApiKey>>(path("/api-keys"), { ...params }),

  createApiKey: (body: { name: string; scopes?: string[]; expiresInDays?: number }) =>
    api.post<CreatedApiKey>(path("/api-keys"), body),

  revokeApiKey: (id: string) => api.delete<ApiKey>(path(`/api-keys/${id}`)),
};
