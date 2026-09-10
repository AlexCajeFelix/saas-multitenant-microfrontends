import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge, Plus } from "lucide-react";
import { billingApi } from "../../api/billing";
import { useTenant } from "../../lib/tenant";
import { useApiMutation, fieldError, optional } from "../../lib/mutations";
import { formatDate, formatNumber } from "../../lib/format";
import { PageHeader, Section } from "../../components/PageHeader";
import { PermissionButton } from "../../components/ui/Button";
import { Field, Input } from "../../components/ui/Field";
import { FormDialog } from "../../components/ui/Dialog";
import { Spinner, EmptyState, QueryError } from "../../components/ui/States";
import { Table, Th, Td, Tr } from "../../components/ui/Table";
import { LimitMeters } from "./LimitMeters";

export function Usage() {
  const { tenantId } = useTenant();
  const [recording, setRecording] = useState(false);
  const [metric, setMetric] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [recordedAt, setRecordedAt] = useState("");

  const usage = useQuery({ queryKey: ["usage", tenantId], queryFn: billingApi.usage });

  const subscription = useQuery({
    queryKey: ["subscription", tenantId],
    queryFn: billingApi.currentSubscription,
  });

  const record = useApiMutation({
    mutationFn: () =>
      billingApi.recordUsage({
        metric: metric.trim().toLowerCase(),
        quantity: Number(quantity),
        recordedAt: optional(recordedAt),
      }),
    invalidate: [["usage", tenantId], ["subscription", tenantId]],
    success: "Consumo registrado",
    onDone: () => {
      setRecording(false);
      setMetric("");
      setQuantity("1");
    },
  });

  return (
    <>
      <PageHeader
        title="Consumo"
        subtitle="Consumo medido do periodo corrente. Entra nas faturas quando elas sao emitidas com consumo incluido."
        actions={
          <PermissionButton
            permission="billing.usage.write"
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => setRecording(true)}
          >
            Registrar consumo
          </PermissionButton>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Metricas do periodo"
          description={
            usage.data
              ? `${formatDate(usage.data.periodStart)} a ${formatDate(usage.data.periodEnd)}`
              : undefined
          }
        >
          {usage.isPending ? (
            <Spinner />
          ) : usage.isError ? (
            <QueryError error={usage.error} />
          ) : usage.data.metrics.length === 0 ? (
            <EmptyState
              icon={<Gauge size={28} />}
              title="Nenhum consumo no periodo"
              message="Registre uma metrica para ve-la aqui e na proxima fatura."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Metrica</Th>
                  <Th align="right">Quantidade</Th>
                  <Th align="right">Eventos</Th>
                </tr>
              </thead>
              <tbody>
                {usage.data.metrics.map((entry) => (
                  <Tr key={entry.metric}>
                    <Td>
                      <code className="font-mono text-xs text-slate-700">{entry.metric}</code>
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {formatNumber(entry.quantity)}
                    </Td>
                    <Td align="right" className="text-slate-500 tabular-nums">
                      {formatNumber(entry.events)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>

        <Section
          title="Limites do plano"
          description="Contagem viva de usuarios, projetos, negocios e contatos."
        >
          {subscription.isPending ? (
            <Spinner />
          ) : subscription.isError ? (
            <QueryError error={subscription.error} />
          ) : (
            <LimitMeters report={subscription.data.limits} />
          )}
        </Section>
      </div>

      <FormDialog
        open={recording}
        title="Registrar consumo"
        description="A metrica segue o formato minusculo com pontos, como api.requests."
        onClose={() => setRecording(false)}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          record.mutate();
        }}
        submitLabel="Registrar"
        submitting={record.isPending}
      >
        <Field label="Metrica" error={fieldError(record.error, "metric")}>
          <Input
            required
            autoFocus
            value={metric}
            onChange={(event) => setMetric(event.target.value)}
            placeholder="api.requests"
            className="font-mono"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Quantidade" error={fieldError(record.error, "quantity")}>
            <Input
              type="number"
              required
              min={0.0001}
              step="any"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Field>
          <Field label="Data" hint="Vazio usa agora." error={fieldError(record.error, "recordedAt")}>
            <Input
              type="date"
              value={recordedAt}
              onChange={(event) => setRecordedAt(event.target.value)}
            />
          </Field>
        </div>
      </FormDialog>
    </>
  );
}
