import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Ban, CreditCard } from "lucide-react";
import { billingApi } from "@saas/platform/api/billing";
import type { ChangePlanResult } from "@saas/platform/api/types";
import { useTenant } from "@saas/platform/lib/tenant";
import { useApiMutation } from "@saas/platform/lib/mutations";
import { formatDate, formatMoney, SUBSCRIPTION_STATUS_LABEL } from "@saas/platform/lib/format";
import { PageHeader, Section, Detail } from "@saas/platform/components/PageHeader";
import { Badge, toneFor } from "@saas/platform/components/ui/Badge";
import { PermissionButton } from "@saas/platform/components/ui/Button";
import { Select } from "@saas/platform/components/ui/Field";
import { ConfirmDialog, Dialog } from "@saas/platform/components/ui/Dialog";
import { Button } from "@saas/platform/components/ui/Button";
import { Spinner, QueryError } from "@saas/platform/components/ui/States";
import { LimitMeters } from "./LimitMeters";

export function SubscriptionPage() {
  const { tenantId } = useTenant();
  const [target, setTarget] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [proration, setProration] = useState<ChangePlanResult | null>(null);

  const current = useQuery({
    queryKey: ["subscription", tenantId],
    queryFn: billingApi.currentSubscription,
  });

  const plans = useQuery({
    queryKey: ["plans", tenantId],
    queryFn: billingApi.listPlans,
    staleTime: 5 * 60_000,
  });

  const invalidate = [
    ["subscription", tenantId],
    ["invoices", tenantId],
  ];

  const change = useApiMutation({
    // Descer de plano e recusado quando o consumo atual nao cabe nos novos
    // limites; o erro traz a lista de violacoes, que o toast mostra em tabela.
    mutationFn: () => billingApi.changePlan(target),
    invalidate,
    onDone: (result) => {
      setTarget("");
      setProration(result);
    },
  });

  const cancel = useApiMutation({
    mutationFn: () => billingApi.cancel(true),
    invalidate,
    success: "Assinatura marcada para encerrar no fim do periodo",
    onDone: () => setCancelling(false),
  });

  if (current.isPending) return <Spinner />;
  if (current.isError) return <QueryError error={current.error} />;

  const { subscription, plan, limits } = current.data;
  const others = (plans.data ?? []).filter(
    (option) => option.code !== plan.code && option.isActive,
  );

  return (
    <>
      <PageHeader
        title="Assinatura"
        subtitle="Trocar de plano no meio do periodo credita o que sobrou do antigo e cobra a mesma fracao do novo."
        actions={
          <PermissionButton
            permission="billing.subscription.write"
            variant="danger"
            icon={<Ban size={15} />}
            onClick={() => setCancelling(true)}
            disabled={subscription.cancelAtPeriodEnd || subscription.status === "cancelled"}
          >
            {subscription.cancelAtPeriodEnd ? "Encerramento agendado" : "Cancelar"}
          </PermissionButton>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <Section title="Plano atual">
            <div className="flex flex-wrap items-start justify-between gap-4 p-4">
              <div>
                <p className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                  <CreditCard size={17} className="text-brand-600" />
                  {plan.name}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">{plan.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone={toneFor(subscription.status)}>
                    {SUBSCRIPTION_STATUS_LABEL[subscription.status]}
                  </Badge>
                  {subscription.isTrialing && <Badge tone="brand">em teste</Badge>}
                  {subscription.cancelAtPeriodEnd && (
                    <Badge tone="warning">encerra no fim do periodo</Badge>
                  )}
                </div>
              </div>
              <p className="text-right text-2xl font-semibold tracking-tight text-slate-900">
                {plan.priceFormatted}
                <span className="block text-xs font-normal text-slate-500">
                  por {plan.interval}
                </span>
              </p>
            </div>

            <dl className="grid gap-3 border-t border-slate-200 p-4 sm:grid-cols-3">
              <Detail label="Periodo atual">
                {formatDate(subscription.currentPeriodStart)} a{" "}
                {formatDate(subscription.currentPeriodEnd)}
              </Detail>
              <Detail label="Fracao restante">
                {Math.round(subscription.remainingRatio * 100)}%
              </Detail>
              <Detail label="Fim do teste">{formatDate(subscription.trialEndsAt)}</Detail>
            </dl>
          </Section>

          <Section
            title="Consumo contra os limites"
            description="A mesma conta que o servico de dominio faz antes de aceitar uma troca de plano."
          >
            <LimitMeters report={limits} />
          </Section>
        </div>

        <Section title="Trocar de plano">
          <div className="space-y-3 p-4">
            <Select value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">selecione um plano</option>
              {others.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name} · {option.priceFormatted}
                </option>
              ))}
            </Select>

            <PermissionButton
              permission="billing.subscription.write"
              variant="primary"
              className="w-full"
              icon={<ArrowRightLeft size={15} />}
              disabled={!target}
              loading={change.isPending}
              onClick={() => change.mutate()}
            >
              Trocar
            </PermissionButton>

            <p className="text-xs text-slate-500">
              Descer de plano e recusado se o consumo atual nao couber nos limites novos. A recusa
              vem com a lista do que excedeu.
            </p>

            <Link
              to="/billing/planos"
              className="block text-xs font-medium text-brand-700 hover:underline"
            >
              Comparar os planos lado a lado
            </Link>
          </div>
        </Section>
      </div>

      <Dialog
        open={Boolean(proration)}
        title="Plano trocado"
        description={proration ? `Agora no ${proration.plan.name}.` : undefined}
        onClose={() => setProration(null)}
        footer={
          <Button variant="primary" onClick={() => setProration(null)}>
            Fechar
          </Button>
        }
      >
        {proration && (
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail label="Credito do plano antigo">
              {formatMoney(proration.proration.creditCents)}
            </Detail>
            <Detail label="Cobranca do plano novo">
              {formatMoney(proration.proration.chargeCents)}
            </Detail>
            <Detail label="Diferenca">{proration.proration.differenceFormatted}</Detail>
            <Detail label="Fracao do periodo usada no rateio">
              {Math.round(proration.proration.remainingRatio * 100)}%
            </Detail>
          </dl>
        )}
      </Dialog>

      <ConfirmDialog
        open={cancelling}
        title="Cancelar assinatura"
        destructive
        confirmLabel="Cancelar assinatura"
        loading={cancel.isPending}
        onClose={() => setCancelling(false)}
        onConfirm={() => cancel.mutate()}
        message="A assinatura segue valendo ate o fim do periodo atual e nao renova depois disso."
      />
    </>
  );
}
