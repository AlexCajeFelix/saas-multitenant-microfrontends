import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { tenancyApi } from "../api/tenancy";
import type { TenantMembership } from "../api/types";
import { useAuth } from "./auth";

const STORAGE_KEY = "saas.tenant";

/**
 * O tenant corrente vive fora do React porque o cliente HTTP precisa dele em
 * toda requisicao, e o cliente HTTP nao e um componente.
 */
let currentTenantId: string | null = null;

try {
  currentTenantId = localStorage.getItem(STORAGE_KEY);
} catch {
  currentTenantId = null;
}

export function getCurrentTenantId(): string | null {
  return currentTenantId;
}

function persist(id: string | null): void {
  currentTenantId = id;
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sem armazenamento, a escolha vale so ate recarregar.
  }
}

interface TenantValue {
  tenants: TenantMembership[];
  tenant: TenantMembership | null;
  tenantId: string | null;
  query: UseQueryResult<TenantMembership[]>;
  select: (id: string | null) => void;
}

const TenantContext = createContext<TenantValue | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [tenantId, setTenantId] = useState<string | null>(() => getCurrentTenantId());

  const query = useQuery({
    queryKey: ["tenants", session?.userId],
    queryFn: tenancyApi.listMyTenants,
    enabled: Boolean(session),
  });

  const tenants = useMemo(() => query.data ?? [], [query.data]);

  const select = useCallback(
    (id: string | null) => {
      if (id === getCurrentTenantId()) return;
      persist(id);
      setTenantId(id);
      // Sem limpar o cache, dados do tenant anterior apareceriam na tela do novo
      // enquanto as consultas nao voltassem. Num sistema multi-tenant isso e
      // exatamente o que nao pode acontecer.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "tenants" });
    },
    [queryClient],
  );

  // Escolhe sozinho quando ha um unico tenant, e descarta uma escolha antiga
  // que nao pertence mais ao usuario.
  useEffect(() => {
    if (!query.isSuccess) return;
    const stillMine = tenants.some((t) => t.id === tenantId);
    if (tenantId && !stillMine) select(null);
    if (!tenantId && tenants.length === 1) select(tenants[0].id);
  }, [query.isSuccess, tenants, tenantId, select]);

  // Sair da conta apaga o tenant escolhido, senao ele vaza para o proximo login.
  useEffect(() => {
    if (!session && getCurrentTenantId()) {
      persist(null);
      setTenantId(null);
    }
  }, [session]);

  const value = useMemo<TenantValue>(
    () => ({
      tenants,
      tenant: tenants.find((t) => t.id === tenantId) ?? null,
      tenantId,
      query,
      select,
    }),
    [tenants, tenantId, query, select],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantValue {
  const value = useContext(TenantContext);
  if (!value) throw new Error("useTenant precisa estar dentro de <TenantProvider>");
  return value;
}
