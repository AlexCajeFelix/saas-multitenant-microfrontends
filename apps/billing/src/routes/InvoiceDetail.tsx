import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2 } from "lucide-react";
import { billingApi } from "@saas/platform/api/billing";
import { useTenant } from "@saas/platform/lib/tenant";
import { useApiMutation } from "@saas/platform/lib/mutations";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  INVOICE_STATUS_LABEL,
} from "@saas/platform/lib/format";
import { PageHeader, Section, Detail } from "@saas/platform/components/PageHeader";
import { Badge, toneFor } from "@saas/platform/components/ui/Badge";
import { PermissionButton } from "@saas/platform/components/ui/Button";
import { ConfirmDialog } from "@saas/platform/components/ui/Dialog";
import { Spinner, EmptyState, QueryError } from "@saas/platform/components/ui/States";
import { Table, Th, Td, Tr } from "@saas/platform/components/ui/Table";

export function InvoiceDetail() {
  const { id = "" } = useParams();
  const { tenantId } = useTenant();
  const [confirming, setConfirming] = useState<"pay" | "void" | null>(null);

  const invoice = useQuery({
    queryKey: ["invoice", tenantId, id],
    queryFn: () => billingApi.getInvoice(id),
  });

  const invalidate = [
    ["invoice", tenantId, id],
    ["invoices", tenantId],
  ];

  const pay = useApiMutation({
    mutationFn: () => billingApi.payInvoice(id),
    invalidate,
    success: "Fatura paga. A partir de agora ela e imutavel.",
    onDone: () => setConfirming(null),
  });

  const voidInvoice = useApiMutation({
    mutationFn: () => billingApi.voidInvoice(id),
    invalidate,
    success: "Fatura anulada",
    onDone: () => setConfirming(null),
  });

  if (invoice.isPending) return <Spinner />;
  if (invoice.isError) return <QueryError error={invoice.error} />;

  const data = invoice.data;
  const lines = [...(data.lines ?? [])].sort((a, b) => a.position - b.position);
  const settled = data.status === "paid" || data.status === "void";

  return (
    <>
      <Link
        to="/billing/faturas"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={13} /> Faturas
      </Link>

      <PageHeader
        title={`Fatura ${data.number}`}
        subtitle={`Periodo de ${formatDate(data.periodStart)} a ${formatDate(data.periodEnd)}.`}
        actions={
          !settled && (
            <>
              <PermissionButton
                permission="billing.invoice.write"
                variant="danger"
                icon={<Ban size={15} />}
                onClick={() => setConfirming("void")}
              >
                Anular
              </PermissionButton>
              <PermissionButton
                permission="billing.invoice.write"
                variant="primary"
                icon={<CheckCircle2 size={15} />}
                onClick={() => setConfirming("pay")}
              >
                Marcar como paga
              </PermissionButton>
            </>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Section title="Linhas" description="O total da fatura e sempre a soma delas.">
          {lines.length === 0 ? (
            <EmptyState title="Fatura sem linhas" />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>Descricao</Th>
                    <Th align="right">Qtd.</Th>
                    <Th align="right">Unitario</Th>
                    <Th align="right">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <Tr key={line.id}>
                      <Td className="text-slate-700">{line.description}</Td>
                      <Td align="right" className="tabular-nums">
                        {line.quantity}
                      </Td>
                      <Td align="right" className="text-slate-500 tabular-nums">
                        {formatMoney(line.unitCents, data.currency)}
                      </Td>
                      <Td align="right" className="font-medium tabular-nums">
                        {line.totalFormatted}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>

              <dl className="space-y-1.5 border-t border-slate-200 px-4 py-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Subtotal</dt>
                  <dd className="tabular-nums">{formatMoney(data.subtotalCents, data.currency)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Impostos</dt>
                  <dd className="tabular-nums">{formatMoney(data.taxCents, data.currency)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-slate-200 pt-1.5 text-base font-semibold text-slate-900">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{data.totalFormatted}</dd>
                </div>
              </dl>
            </>
          )}
        </Section>

        <Section title="Situacao">
          <div className="space-y-3 p-4">
            <Badge tone={toneFor(data.status)}>{INVOICE_STATUS_LABEL[data.status]}</Badge>
            {data.status === "paid" && (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Fatura paga e imutavel: nem linhas nem totais mudam mais.
              </p>
            )}
            <dl className="grid gap-3">
              <Detail label="Emitida em">{formatDateTime(data.issuedAt)}</Detail>
              <Detail label="Vencimento">{formatDate(data.dueAt)}</Detail>
              <Detail label="Paga em">{formatDateTime(data.paidAt)}</Detail>
              <Detail label="Criada em">{formatDateTime(data.createdAt)}</Detail>
            </dl>
          </div>
        </Section>
      </div>

      <ConfirmDialog
        open={confirming === "pay"}
        title="Marcar fatura como paga"
        confirmLabel="Confirmar pagamento"
        loading={pay.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => pay.mutate()}
        message={`${data.totalFormatted} entram como pagos. Depois disso a fatura nao muda mais.`}
      />

      <ConfirmDialog
        open={confirming === "void"}
        title="Anular fatura"
        destructive
        confirmLabel="Anular"
        loading={voidInvoice.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => voidInvoice.mutate()}
        message="A fatura deixa de ser cobravel e fica registrada como anulada."
      />
    </>
  );
}
