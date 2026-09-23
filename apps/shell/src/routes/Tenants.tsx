import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Building2, LogOut, Plus, ArrowRight } from "lucide-react";
import { useAuth } from "@saas/platform/lib/auth";
import { useTenant } from "@saas/platform/lib/tenant";
import { tenancyApi } from "@saas/platform/api/tenancy";
import { useApiMutation, fieldError, optional } from "@saas/platform/lib/mutations";
import { roleLabel, formatDate } from "@saas/platform/lib/format";
import { Button } from "@saas/platform/components/ui/Button";
import { Field, Input } from "@saas/platform/components/ui/Field";
import { Badge, toneFor } from "@saas/platform/components/ui/Badge";
import { Spinner, EmptyState, QueryError } from "@saas/platform/components/ui/States";
import { TENANT_STATUS_LABEL } from "@saas/platform/lib/format";

export function Tenants() {
  const { session, signOut } = useAuth();
  const { tenants, tenantId, select, query } = useTenant();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const create = useApiMutation({
    mutationFn: () => tenancyApi.createTenant({ name: name.trim(), slug: optional(slug) }),
    invalidate: [["tenants"]],
    success: "Tenant criado, com voce como dono",
    onDone: (tenant) => {
      // Criar um tenant ja provisiona o funil do CRM e a assinatura inicial.
      select(tenant.id);
      navigate("/");
    },
  });

  function enter(id: string) {
    select(id);
    navigate("/");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-12">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Seus tenants</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Entrando como {session?.email}. Cada tenant tem os proprios dados e o seu papel.
          </p>
        </div>
        <Button variant="ghost" size="sm" icon={<LogOut size={14} />} onClick={signOut}>
          Sair
        </Button>
      </header>

      <div className="card overflow-hidden">
        {query.isPending ? (
          <Spinner />
        ) : query.isError ? (
          <QueryError error={query.error} />
        ) : tenants.length === 0 ? (
          <EmptyState
            icon={<Building2 size={28} />}
            title="Voce ainda nao pertence a nenhum tenant"
            message="Crie o seu abaixo, ou aceite um convite que tenham mandado."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {tenants.map((tenant) => (
              <li key={tenant.id}>
                <button
                  type="button"
                  onClick={() => enter(tenant.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                >
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                    <Building2 size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{tenant.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {tenant.slug} · membro desde {formatDate(tenant.joinedAt)}
                    </p>
                  </div>
                  <Badge tone="brand">{roleLabel(tenant.myRole)}</Badge>
                  {tenant.status !== "active" && (
                    <Badge tone={toneFor(tenant.status)}>
                      {TENANT_STATUS_LABEL[tenant.status]}
                    </Badge>
                  )}
                  {tenant.id === tenantId ? (
                    <Badge tone="neutral">atual</Badge>
                  ) : (
                    <ArrowRight size={15} className="shrink-0 text-slate-300" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-slate-200 bg-slate-50 p-4">
          {creating ? (
            <form onSubmit={submit} className="space-y-3">
              <Field label="Nome" error={fieldError(create.error, "name")}>
                <Input
                  autoFocus
                  required
                  minLength={2}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Minha empresa"
                />
              </Field>
              <Field
                label="Slug"
                hint="Opcional. Sem informar, sai do nome."
                error={fieldError(create.error, "slug")}
              >
                <Input
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  placeholder="minha-empresa"
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" loading={create.isPending}>
                  Criar tenant
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
              Criar um tenant
            </Button>
          )}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-slate-500">
        Recebeu um convite?{" "}
        <Link to="/convite" className="font-medium text-brand-700 hover:underline">
          Informe o token aqui
        </Link>
        .
      </p>
    </div>
  );
}
