import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Handshake, FolderKanban, CreditCard, ShieldCheck } from "lucide-react";
import { crmApi } from "../api/crm";
import { projectsApi } from "../api/projects";
import { billingApi } from "../api/billing";
import { useTenant } from "../lib/tenant";
import { usePermissions } from "../lib/permissions";
import { isApiError } from "../lib/api-error";
import {
  formatMoney,
  formatNumber,
  PROJECT_STATUS_LABEL,
  roleLabel,
  SUBSCRIPTION_STATUS_LABEL,
} from "../lib/format";
import { PageHeader, Section } from "../components/PageHeader";
import { Badge, toneFor } from "../components/ui/Badge";
import { Spinner } from "../components/ui/States";

export function Overview() {
  const { tenant, tenantId } = useTenant();
  const { role, whoami } = usePermissions();

  const pipeline = useQuery({
    queryKey: ["pipeline", tenantId],
    queryFn: crmApi.pipeline,
  });

  const projects = useQuery({
    queryKey: ["projects", tenantId, "overview"],
    queryFn: () => projectsApi.listProjects({ pageSize: 5, sort: "updated_at" }),
  });

  const subscription = useQuery({
    queryKey: ["subscription", tenantId],
    queryFn: billingApi.currentSubscription,
  });

  const totals = pipeline.data?.totals;
  const limits = subscription.data?.limits;

  return (
    <>
      <PageHeader
        title={tenant?.name ?? "Visao geral"}
        subtitle={`Voce e ${roleLabel(role)} aqui, com ${whoami?.permissions.length ?? 0} permissoes efetivas neste tenant.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Negocios no funil"
          value={totals ? formatNumber(totals.deals) : "—"}
          hint={totals ? `${formatMoney(totals.totalCents)} em valor bruto` : undefined}
          icon={<Handshake size={15} />}
          to="/crm/funil"
          error={pipeline.error}
        />
        <Tile
          label="Valor ponderado"
          value={totals ? formatMoney(totals.weightedCents) : "—"}
          hint="Valor de cada negocio pela probabilidade do estagio"
          icon={<Handshake size={15} />}
          to="/crm/negocios"
          error={pipeline.error}
        />
        <Tile
          label="Projetos"
          value={projects.data ? formatNumber(projects.data.total) : "—"}
          hint={projects.data ? `${projects.data.items.length} recentes abaixo` : undefined}
          icon={<FolderKanban size={15} />}
          to="/projetos"
          error={projects.error}
        />
        <Tile
          label="Plano"
          value={subscription.data?.plan.name ?? "—"}
          hint={
            subscription.data
              ? SUBSCRIPTION_STATUS_LABEL[subscription.data.subscription.status]
              : undefined
          }
          icon={<CreditCard size={15} />}
          to="/billing/assinatura"
          error={subscription.error}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section
          title="Funil por estagio"
          description="Cada tenant configura os proprios estagios."
          actions={
            <Link to="/crm/funil" className="text-xs font-medium text-brand-700 hover:underline">
              abrir
            </Link>
          }
        >
          {pipeline.isPending ? (
            <Spinner />
          ) : pipeline.isError ? (
            <Locked error={pipeline.error} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {pipeline.data.stages.map((stage) => {
                const share = totals?.totalCents
                  ? Math.round((stage.totalCents / totals.totalCents) * 100)
                  : 0;
                return (
                  <li key={stage.stageKey} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate font-medium text-slate-700">{stage.stageName}</span>
                      <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                        {stage.dealsCount} · {formatMoney(stage.totalCents)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${Math.max(share, stage.dealsCount ? 2 : 0)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <div className="space-y-4">
          <Section
            title="Consumo contra os limites do plano"
            description="A mesma conta que recusa uma descida de plano."
          >
            {subscription.isPending ? (
              <Spinner />
            ) : subscription.isError ? (
              <Locked error={subscription.error} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {Object.entries(limits?.limits ?? {}).map(([resource, limit]) => {
                  const current = Number(limits?.usage?.[resource] ?? 0);
                  const pct = limit ? Math.min(Math.round((current / limit) * 100), 100) : 0;
                  const over = limit !== null && current > limit;
                  return (
                    <li key={resource} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium text-slate-700 capitalize">{resource}</span>
                        <span
                          className={`text-xs tabular-nums ${over ? "font-semibold text-rose-600" : "text-slate-500"}`}
                        >
                          {current} / {limit ?? "ilimitado"}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${over ? "bg-rose-500" : "bg-emerald-500"}`}
                          style={{ width: `${limit ? pct : 4}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            title="Projetos recentes"
            actions={
              <Link to="/projetos" className="text-xs font-medium text-brand-700 hover:underline">
                ver todos
              </Link>
            }
          >
            {projects.isPending ? (
              <Spinner />
            ) : projects.isError ? (
              <Locked error={projects.error} />
            ) : projects.data.items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">Nenhum projeto ainda.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {projects.data.items.map((project) => (
                  <li key={project.id}>
                    <Link
                      to={`/projetos/${project.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50"
                    >
                      <code className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                        {project.code}
                      </code>
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                        {project.name}
                      </span>
                      <Badge tone={toneFor(project.status)}>
                        {PROJECT_STATUS_LABEL[project.status]}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  icon,
  to,
  error,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  to: string;
  error: unknown;
}) {
  const forbidden = isApiError(error) && error.code === "FORBIDDEN";
  return (
    <Link to={to} className="card group p-4 transition-colors hover:border-brand-200">
      <div className="flex items-center justify-between text-slate-400">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          {icon}
          {label}
        </span>
        <ArrowUpRight size={14} className="opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
        {forbidden ? "—" : value}
      </p>
      <p className="mt-0.5 truncate text-xs text-slate-500">
        {forbidden ? "seu papel nao le este modulo" : hint}
      </p>
    </Link>
  );
}

function Locked({ error }: { error: unknown }) {
  const forbidden = isApiError(error) && error.code === "FORBIDDEN";
  return (
    <p className="flex items-center justify-center gap-2 px-4 py-8 text-center text-sm text-slate-500">
      <ShieldCheck size={15} className="text-slate-300" />
      {forbidden ? "Seu papel nao alcanca este modulo." : "Nao consegui carregar."}
    </p>
  );
}
