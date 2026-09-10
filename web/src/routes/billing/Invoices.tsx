import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { FilePlus2, Receipt } from "lucide-react";
import { billingApi } from "../../api/billing";
import type { InvoiceStatus } from "../../api/types";
import { useTenant } from "../../lib/tenant";
import { useApiMutation, fieldError } from "../../lib/mutations";
import { formatDate, INVOICE_STATUS_LABEL, parseMoneyToCents } from "../../lib/format";
import { PageHeader, Section } from "../../components/PageHeader";
import { Badge, toneFor } from "../../components/ui/Badge";
import { PermissionButton } from "../../components/ui/Button";
import { Field, Input, MoneyInput } from "../../components/ui/Field";
import { FormDialog } from "../../components/ui/Dialog";
import { Spinner, EmptyState, QueryError } from "../../components/ui/States";
import { Table, Th, Td, Tr, Pagination } from "../../components/ui/Table";

export function Invoices() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<InvoiceStatus | "">("");
  const [issuing, setIssuing] = useState(false);
  const [dueInDays, setDueInDays] = useState("15");
  const [tax, setTax] = useState("");
  const [includeUsage, setIncludeUsage] = useState(true);

  const invoices = useQuery({
    queryKey: ["invoices", tenantId, page, status],
    queryFn: () => billingApi.listInvoices({ page, status: status || undefined, sort: "created_at" }),
    placeholderData: keepPreviousData,
  });

  const issue = useApiMutation({
    mutationFn: () =>
      billingApi.issueInvoice({
        dueInDays: Number(dueInDays),
        taxCents: parseMoneyToCents(tax),
        includeUsage,
      }),
    invalidate: [["invoices", tenantId]],
    success: "Fatura emitida",
    onDone: (invoice) => {
      setIssuing(false);
      navigate(`/billing/faturas/${invoice.id}`);
    },
  });

  const TABS: { value: InvoiceStatus | ""; label: string }[] = [
    { value: "", label: "Todas" },
    { value: "open", label: "Em aberto" },
    { value: "paid", label: "Pagas" },
    { value: "draft", label: "Rascunho" },
    { value: "void", label: "Anuladas" },
  ];

  return (
    <>
      <PageHeader
        title="Faturas"
        subtitle="Os totais sao sempre derivados das linhas, e fatura paga nao muda mais."
        actions={
          <PermissionButton
            permission="billing.invoice.write"
            variant="primary"
            icon={<FilePlus2 size={15} />}
            onClick={() => setIssuing(true)}
          >
            Emitir fatura
          </PermissionButton>
        }
      />

      <Section>
        <div className="flex flex-wrap gap-1 border-b border-slate-200 p-2">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => {
                setStatus(tab.value);
                setPage(1);
              }}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                status === tab.value
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {invoices.isPending ? (
          <Spinner />
        ) : invoices.isError ? (
          <QueryError error={invoices.error} />
        ) : invoices.data.items.length === 0 ? (
          <EmptyState
            icon={<Receipt size={28} />}
            title="Nenhuma fatura"
            message="Emita uma fatura para o periodo corrente da assinatura."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Numero</Th>
                  <Th>Situacao</Th>
                  <Th>Periodo</Th>
                  <Th>Vencimento</Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {invoices.data.items.map((invoice) => (
                  <Tr key={invoice.id} onClick={() => navigate(`/billing/faturas/${invoice.id}`)}>
                    <Td>
                      <Link
                        to={`/billing/faturas/${invoice.id}`}
                        className="font-mono text-xs font-medium text-slate-800 hover:text-brand-700"
                      >
                        {invoice.number}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={toneFor(invoice.status)}>
                        {INVOICE_STATUS_LABEL[invoice.status]}
                      </Badge>
                    </Td>
                    <Td className="text-slate-500">
                      {formatDate(invoice.periodStart)} a {formatDate(invoice.periodEnd)}
                    </Td>
                    <Td className="text-slate-500">{formatDate(invoice.dueAt)}</Td>
                    <Td align="right" className="font-medium tabular-nums">
                      {invoice.totalFormatted}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={invoices.data} onChange={setPage} label="faturas" />
          </>
        )}
      </Section>

      <FormDialog
        open={issuing}
        title="Emitir fatura"
        description="Cobre o periodo corrente da assinatura, opcionalmente com o consumo medido."
        onClose={() => setIssuing(false)}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          issue.mutate();
        }}
        submitLabel="Emitir"
        submitting={issue.isPending}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Vencimento em (dias)"
            hint="De 0 a 90."
            error={fieldError(issue.error, "dueInDays")}
          >
            <Input
              type="number"
              min={0}
              max={90}
              value={dueInDays}
              onChange={(event) => setDueInDays(event.target.value)}
            />
          </Field>
          <Field label="Imposto (R$)" error={fieldError(issue.error, "taxCents")}>
            <MoneyInput value={tax} onChange={(event) => setTax(event.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="size-3.5 accent-indigo-600"
            checked={includeUsage}
            onChange={(event) => setIncludeUsage(event.target.checked)}
          />
          Incluir o consumo medido do periodo como linhas da fatura
        </label>
      </FormDialog>
    </>
  );
}
