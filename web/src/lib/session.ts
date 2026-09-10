import { connectSession } from "./http";
import { authHandlers, peekSession } from "./auth";
import { getCurrentTenantId } from "./tenant";

/**
 * Liga o cliente HTTP a sessao e ao tenant corrente. Roda uma vez, no boot,
 * antes de qualquer consulta — por isso e um efeito colateral de modulo e nao
 * um efeito de componente.
 */
connectSession({
  accessToken: () => peekSession()?.accessToken ?? null,
  tenantId: getCurrentTenantId,
  refresh: async () => (authHandlers.refresh ? await authHandlers.refresh() : false),
  logout: () => authHandlers.logout?.(),
});
