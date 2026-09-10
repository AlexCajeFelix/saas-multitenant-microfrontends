import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { iamApi } from "../api/iam";
import type { WhoAmI } from "../api/types";
import { useTenant } from "./tenant";

interface PermissionsValue {
  whoami: WhoAmI | null;
  role: string | null;
  permissions: Set<string>;
  loading: boolean;
  /** `owner` recebe tudo por atalho na propria funcao de autorizacao. */
  can: (permission: string) => boolean;
}

const PermissionsContext = createContext<PermissionsValue | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { tenantId } = useTenant();

  const query = useQuery({
    queryKey: ["whoami", tenantId],
    queryFn: iamApi.whoami,
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });

  const value = useMemo<PermissionsValue>(() => {
    const whoami = query.data ?? null;
    const permissions = new Set(whoami?.permissions ?? []);
    const isOwner = whoami?.role === "owner";
    return {
      whoami,
      role: whoami?.role ?? null,
      permissions,
      loading: query.isLoading,
      can: (permission: string) => isOwner || permissions.has(permission),
    };
  }, [query.data, query.isLoading]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions(): PermissionsValue {
  const value = useContext(PermissionsContext);
  if (!value) throw new Error("usePermissions precisa estar dentro de <PermissionsProvider>");
  return value;
}

export function useCan(permission: string): boolean {
  return usePermissions().can(permission);
}

/**
 * Envolve algo que so faz sentido com uma permissao. O padrao e nao esconder:
 * trocando de usuario, o interessante e ver a acao travada, com o motivo, em
 * vez de ela simplesmente sumir da tela.
 */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useCan(permission) ? <>{children}</> : <>{fallback}</>;
}
