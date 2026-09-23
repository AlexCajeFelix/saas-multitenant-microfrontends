import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";

import "./styles.css";
// Liga o cliente HTTP a sessao antes de qualquer componente montar.
import "./lib/session";
import { AuthProvider, useAuth } from "./lib/auth";
import { TenantProvider, useTenant } from "./lib/tenant";
import { PermissionsProvider } from "./lib/permissions";
import { ToastProvider } from "./lib/toast";
import { queryClient } from "./lib/query";
import { setCurrentZone, type ZoneName } from "./lib/zones";
import { Shell } from "./components/Shell";
import { AppNavigate } from "./components/AppLink";
import { Spinner } from "./components/ui/States";

function RequireAuth() {
  const { session, ready } = useAuth();
  const location = useLocation();

  if (!ready) return <Spinner label="Abrindo a sessao" />;
  if (!session) {
    // O login mora no shell; de outra zona isso e um salto de pagina inteira.
    const next = encodeURIComponent(location.pathname + location.search);
    return <AppNavigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

/**
 * Sem tenant escolhido nao ha `x-tenant-id`, e sem ele quase toda rota do
 * backend responde 403. Entao a escolha vem antes da aplicacao.
 */
function RequireTenant() {
  const { tenantId, query } = useTenant();

  if (!tenantId && query.isPending) return <Spinner label="Carregando seus tenants" />;
  if (!tenantId) return <AppNavigate to="/tenants" replace />;
  return <Outlet />;
}

export interface ZoneDefinition {
  zone: ZoneName;
  /** Rotas sem login (so o shell tem: /login). */
  publicRoutes?: ReactNode;
  /** Rotas com login mas antes de escolher tenant (/tenants, /convite). */
  sessionRoutes?: ReactNode;
  /** Rotas da aplicacao, dentro do layout com menu. */
  routes: ReactNode;
}

/**
 * Monta uma zona: provedores, guardas e o layout comum. Toda zona passa por
 * aqui, entao sessao, tenant, permissoes e menu se comportam igual em todas.
 */
export function mountZone({ zone, publicRoutes, sessionRoutes, routes }: ZoneDefinition): void {
  setCurrentZone(zone);

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <TenantProvider>
              <PermissionsProvider>
                <ToastProvider>
                  <Routes>
                    {publicRoutes}
                    <Route element={<RequireAuth />}>
                      {sessionRoutes}
                      <Route element={<RequireTenant />}>
                        <Route element={<Shell />}>{routes}</Route>
                      </Route>
                    </Route>
                  </Routes>
                </ToastProvider>
              </PermissionsProvider>
            </TenantProvider>
          </QueryClientProvider>
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}
