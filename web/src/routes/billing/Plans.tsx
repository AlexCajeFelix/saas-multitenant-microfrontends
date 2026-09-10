import { useQuery } from "@tanstack/react-query";
import { Check, Minus } from "lucide-react";
import { billingApi } from "../../api/billing";
import { useTenant } from "../../lib/tenant";
import { useApiMutation } from "../../lib/mutations";
import { PageHeader } from "../../components/PageHeader";
import { Badge } from "../../components/ui/Badge";
import { PermissionButton } from "../../components/ui/Button";
import { Spinner, QueryError } from "../../components/ui/States";

const LIMIT_LABEL: Record<string, string> = {
  users: "usuarios",
  projects: "projetos",
  deals: "negocios",
  contacts: "contatos",
};

export function Plans() {
  const { tenantId } = useTenant();

  const plans = useQuery({
    queryKey: ["plans", tenantId],
    queryFn: billingApi.listPlans,
    staleTime: 5 * 60_000,
  });

  const current = useQuery({
    queryKey: ["subscription", tenantId],
    queryFn: billingApi.currentSubscription,
  });

  const change = useApiMutation({
    mutationFn: (planCode: string) => billingApi.changePlan(planCode),
    invalidate: [["subscription", tenantId], ["invoices", tenantId]],
    success: "Plano trocado, com o rateio aplicado",
  });

  if (plans.isPending) return <Spinner />;
  if (plans.isError) return <QueryError error={plans.error} />;

  const activeCode = current.data?.plan.code;

  return (
    <>
      <PageHeader
        title="Planos"
        subtitle="Os limites de cada plano sao verificados a cada escrita e na hora de trocar de plano."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[...plans.data]
          .sort((a, b) => a.position - b.position)
          .map((plan) => {
            const isCurrent = plan.code === activeCode;
            return (
              <article
                key={plan.id}
                className={`card flex flex-col p-4 ${isCurrent ? "border-brand-300 ring-1 ring-brand-200" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">{plan.name}</h2>
                  {isCurrent && <Badge tone="brand">atual</Badge>}
                </div>

                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                  {plan.priceFormatted}
                  <span className="text-xs font-normal text-slate-500"> / {plan.interval}</span>
                </p>
                <p className="mt-1 min-h-8 text-xs text-slate-500">{plan.description}</p>

                {plan.trialDays > 0 && (
                  <p className="mt-1 text-xs text-brand-700">{plan.trialDays} dias de teste</p>
                )}

                <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs">
                  {Object.entries(plan.limits).map(([resource, limit]) => (
                    <div key={resource} className="flex justify-between gap-2">
                      <dt className="text-slate-500">{LIMIT_LABEL[resource] ?? resource}</dt>
                      <dd className="font-medium text-slate-700 tabular-nums">
                        {limit === null ? "ilimitado" : limit}
                      </dd>
                    </div>
                  ))}
                </dl>

                {plan.features.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-1.5 text-xs text-slate-600">
                        <Check size={12} className="mt-0.5 shrink-0 text-emerald-600" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-auto pt-4">
                  <PermissionButton
                    permission="billing.subscription.write"
                    variant={isCurrent ? "secondary" : "primary"}
                    className="w-full"
                    disabled={isCurrent || !plan.isActive}
                    loading={change.isPending && change.variables === plan.code}
                    onClick={() => change.mutate(plan.code)}
                    icon={isCurrent ? <Minus size={14} /> : undefined}
                  >
                    {isCurrent ? "Plano atual" : "Mudar para este"}
                  </PermissionButton>
                </div>
              </article>
            );
          })}
      </div>
    </>
  );
}
