import { Navigate, Outlet, Route, BrowserRouter, Routes, useLocation } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";

import { AuthProvider, useAuth } from "./lib/auth";
import { TenantProvider, useTenant } from "./lib/tenant";
import { PermissionsProvider } from "./lib/permissions";
import { ToastProvider } from "./lib/toast";
import { queryClient } from "./lib/query";
import { Shell } from "./components/Shell";
import { Spinner } from "./components/ui/States";

import { Login } from "./routes/Login";
import { AcceptInvite } from "./routes/AcceptInvite";
import { Tenants } from "./routes/Tenants";
import { Overview } from "./routes/Overview";
import { Members } from "./routes/tenancy/Members";
import { Invitations } from "./routes/tenancy/Invitations";
import { TenantSettings } from "./routes/tenancy/TenantSettings";
import { Roles } from "./routes/iam/Roles";
import { RoleDetail } from "./routes/iam/RoleDetail";
import { Permissions } from "./routes/iam/Permissions";
import { ApiKeys } from "./routes/iam/ApiKeys";
import { PipelineBoard } from "./routes/crm/PipelineBoard";
import { Deals } from "./routes/crm/Deals";
import { DealDetail } from "./routes/crm/DealDetail";
import { Companies } from "./routes/crm/Companies";
import { Contacts } from "./routes/crm/Contacts";
import { Projects } from "./routes/projects/Projects";
import { ProjectDetail } from "./routes/projects/ProjectDetail";
import { Tasks } from "./routes/projects/Tasks";
import { TaskDetail } from "./routes/projects/TaskDetail";
import { SubscriptionPage } from "./routes/billing/SubscriptionPage";
import { Plans } from "./routes/billing/Plans";
import { Usage } from "./routes/billing/Usage";
import { Invoices } from "./routes/billing/Invoices";
import { InvoiceDetail } from "./routes/billing/InvoiceDetail";
import { NotFound } from "./routes/NotFound";

function RequireAuth() {
  const { session, ready } = useAuth();
  const location = useLocation();

  if (!ready) return <Spinner label="Abrindo a sessao" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

/**
 * Sem tenant escolhido nao ha `x-tenant-id`, e sem ele quase toda rota do
 * backend responde 403. Entao a escolha vem antes da aplicacao.
 */
function RequireTenant() {
  const { tenantId, query } = useTenant();

  if (!tenantId && query.isPending) return <Spinner label="Carregando seus tenants" />;
  if (!tenantId) return <Navigate to="/tenants" replace />;
  return <Outlet />;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <TenantProvider>
            <PermissionsProvider>
              <ToastProvider>
                <Routes>
                  <Route path="/login" element={<Login />} />

                  <Route element={<RequireAuth />}>
                    <Route path="/convite" element={<AcceptInvite />} />
                    <Route path="/tenants" element={<Tenants />} />

                    <Route element={<RequireTenant />}>
                      <Route element={<Shell />}>
                        <Route index element={<Overview />} />

                        <Route path="tenancy/membros" element={<Members />} />
                        <Route path="tenancy/convites" element={<Invitations />} />
                        <Route path="tenancy/ajustes" element={<TenantSettings />} />

                        <Route path="iam/papeis" element={<Roles />} />
                        <Route path="iam/papeis/:slug" element={<RoleDetail />} />
                        <Route path="iam/permissoes" element={<Permissions />} />
                        <Route path="iam/chaves" element={<ApiKeys />} />

                        <Route path="crm/funil" element={<PipelineBoard />} />
                        <Route path="crm/negocios" element={<Deals />} />
                        <Route path="crm/negocios/:id" element={<DealDetail />} />
                        <Route path="crm/empresas" element={<Companies />} />
                        <Route path="crm/contatos" element={<Contacts />} />

                        <Route path="projetos" element={<Projects />} />
                        <Route path="projetos/:id" element={<ProjectDetail />} />
                        <Route path="tarefas" element={<Tasks />} />
                        <Route path="tarefas/:id" element={<TaskDetail />} />

                        <Route path="billing/assinatura" element={<SubscriptionPage />} />
                        <Route path="billing/planos" element={<Plans />} />
                        <Route path="billing/consumo" element={<Usage />} />
                        <Route path="billing/faturas" element={<Invoices />} />
                        <Route path="billing/faturas/:id" element={<InvoiceDetail />} />

                        <Route path="*" element={<NotFound />} />
                      </Route>
                    </Route>
                  </Route>
                </Routes>
              </ToastProvider>
            </PermissionsProvider>
          </TenantProvider>
        </QueryClientProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
