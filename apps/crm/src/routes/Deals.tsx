import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { crmApi } from "@saas/platform/api/crm";
import type { DealStatus } from "@saas/platform/api/types";
import { useTenant } from "@saas/platform/lib/tenant";
import { DEAL_STATUS_LABEL, formatDate, formatMoney } from "@saas/platform/lib/format";
import { PageHeader, Section } from "@saas/platform/components/PageHeader";
import { Badge, toneFor } from "@saas/platform/components/ui/Badge";
import { PermissionButton } from "@saas/platform/components/ui/Button";
import { Input, Select } from "@saas/platform/components/ui/Field";
import { Spinner, EmptyState, QueryError } from "@saas/platform/components/ui/States";
import { Table, Th, Td, Tr, Pagination } from "@saas/platform/components/ui/Table";
import { DealFormDialog } from "./DealFormDialog";

export function Deals() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<DealStatus | "">("");
  const [creating, setCreating] = useState(false);

  const deals = useQuery({
    queryKey: ["deals", tenantId, page, search, status],
    queryFn: () =>
      crmApi.listDeals({
        page,
        search: search || undefined,
        status: status || undefined,
        sort: "updated_at",
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Negocios"
        subtitle="A mesma base do funil, em lista, com busca e filtro por situacao."
        actions={
          <PermissionButton
            permission="crm.deal.write"
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => setCreating(true)}
          >
            Novo negocio
          </PermissionButton>
        }
      />

      <Section>
        <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
          <div className="relative min-w-48 flex-1">
            <Search
              size={14}
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
            />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Buscar por titulo"
              className="pl-8"
            />
          </div>
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as DealStatus | "");
              setPage(1);
            }}
            className="w-40"
          >
            <option value="">todas as situacoes</option>
            <option value="open">Abertos</option>
            <option value="won">Ganhos</option>
            <option value="lost">Perdidos</option>
          </Select>
        </div>

        {deals.isPending ? (
          <Spinner />
        ) : deals.isError ? (
          <QueryError error={deals.error} />
        ) : deals.data.items.length === 0 ? (
          <EmptyState
            title="Nenhum negocio encontrado"
            message={search ? "Tente outra busca." : "Crie o primeiro para comecar o funil."}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Negocio</Th>
                  <Th>Estagio</Th>
                  <Th align="right">Valor</Th>
                  <Th align="right">Ponderado</Th>
                  <Th>Previsao</Th>
                  <Th>Situacao</Th>
                </tr>
              </thead>
              <tbody>
                {deals.data.items.map((deal) => (
                  <Tr key={deal.id} onClick={() => navigate(`/crm/negocios/${deal.id}`)}>
                    <Td>
                      <Link
                        to={`/crm/negocios/${deal.id}`}
                        className="font-medium text-slate-800 hover:text-brand-700"
                      >
                        {deal.title}
                      </Link>
                    </Td>
                    <Td>
                      <span className="text-xs text-slate-600">{deal.stageKey}</span>
                      <span className="ml-1.5 text-xs text-slate-400">{deal.probability}%</span>
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {deal.amountFormatted}
                    </Td>
                    <Td align="right" className="text-slate-500 tabular-nums">
                      {formatMoney(deal.weightedCents, deal.currency)}
                    </Td>
                    <Td className="text-slate-500">{formatDate(deal.expectedCloseDate)}</Td>
                    <Td>
                      <Badge tone={toneFor(deal.status)}>{DEAL_STATUS_LABEL[deal.status]}</Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={deals.data} onChange={setPage} label="negocios" />
          </>
        )}
      </Section>

      <DealFormDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
