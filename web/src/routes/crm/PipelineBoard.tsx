import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { GripVertical, Plus, Trophy, XCircle } from "lucide-react";
import { crmApi } from "../../api/crm";
import type { Deal } from "../../api/types";
import { useTenant } from "../../lib/tenant";
import { useCan } from "../../lib/permissions";
import { useApiMutation } from "../../lib/mutations";
import { formatDate, formatMoney } from "../../lib/format";
import { PageHeader } from "../../components/PageHeader";
import { Badge } from "../../components/ui/Badge";
import { PermissionButton } from "../../components/ui/Button";
import { Field, Textarea } from "../../components/ui/Field";
import { FormDialog } from "../../components/ui/Dialog";
import { Spinner, QueryError, EmptyState } from "../../components/ui/States";
import { DealFormDialog } from "./DealFormDialog";

/**
 * O quadro do funil. Arrastar um cartao chama a rota de mudanca de estagio, e o
 * negocio adota a probabilidade do estagio de destino. Ganho e perda sao
 * terminais e tem rotas proprias, entao soltar nessas colunas nao passa por
 * `/stage`: vai por `/win` ou abre o dialogo que captura o motivo da perda.
 */
export function PipelineBoard() {
  const { tenantId } = useTenant();
  const canWrite = useCan("crm.deal.write");
  const [dragging, setDragging] = useState<Deal | null>(null);
  const [losing, setLosing] = useState<Deal | null>(null);
  const [reason, setReason] = useState("");
  const [creating, setCreating] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const pipeline = useQuery({ queryKey: ["pipeline", tenantId], queryFn: crmApi.pipeline });

  const deals = useQuery({
    queryKey: ["deals", tenantId, "board"],
    queryFn: () => crmApi.listDeals({ pageSize: 100, sort: "updated_at" }),
  });

  const invalidate = [["pipeline", tenantId], ["deals", tenantId]];

  const move = useApiMutation({
    mutationFn: ({ id, stageKey }: { id: string; stageKey: string }) => crmApi.moveDeal(id, stageKey),
    invalidate,
  });

  const win = useApiMutation({
    mutationFn: (id: string) => crmApi.winDeal(id),
    invalidate,
    success: "Negocio marcado como ganho",
  });

  const lose = useApiMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) => crmApi.loseDeal(id, why),
    invalidate,
    success: "Negocio marcado como perdido",
    onDone: () => {
      setLosing(null);
      setReason("");
    },
  });

  const byStage = useMemo(() => {
    const groups = new Map<string, Deal[]>();
    for (const deal of deals.data?.items ?? []) {
      const list = groups.get(deal.stageKey) ?? [];
      list.push(deal);
      groups.set(deal.stageKey, list);
    }
    return groups;
  }, [deals.data]);

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const deal = event.active.data.current?.deal as Deal | undefined;
    const stageKey = event.over?.id as string | undefined;
    if (!deal || !stageKey || stageKey === deal.stageKey) return;
    if (deal.status !== "open") return;

    if (stageKey === "won") win.mutate(deal.id);
    else if (stageKey === "lost") setLosing(deal);
    else move.mutate({ id: deal.id, stageKey });
  }

  function onDragStart(event: DragStartEvent) {
    setDragging((event.active.data.current?.deal as Deal) ?? null);
  }

  if (pipeline.isPending || deals.isPending) return <Spinner />;
  if (pipeline.isError) return <QueryError error={pipeline.error} />;
  if (deals.isError) return <QueryError error={deals.error} />;

  const totals = pipeline.data.totals;

  return (
    <>
      <PageHeader
        title="Funil"
        subtitle={`${totals.deals} negocios · ${formatMoney(totals.totalCents)} bruto · ${formatMoney(totals.weightedCents)} ponderado pela probabilidade de cada estagio.`}
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

      {totals.deals === 0 ? (
        <div className="card">
          <EmptyState
            title="Funil vazio"
            message="Crie o primeiro negocio para ver as colunas ganharem cartoes."
          />
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {pipeline.data.stages.map((stage) => (
              <Column
                key={stage.stageKey}
                stageKey={stage.stageKey}
                name={stage.stageName}
                count={stage.dealsCount}
                totalCents={stage.totalCents}
                deals={byStage.get(stage.stageKey) ?? []}
                draggable={canWrite}
              />
            ))}
          </div>

          <DragOverlay>{dragging && <Card deal={dragging} overlay />}</DragOverlay>
        </DndContext>
      )}

      <FormDialog
        open={Boolean(losing)}
        title="Marcar como perdido"
        description={losing?.title}
        onClose={() => setLosing(null)}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (losing) lose.mutate({ id: losing.id, why: reason.trim() });
        }}
        submitLabel="Registrar perda"
        submitting={lose.isPending}
      >
        <Field
          label="Motivo"
          hint="Entre 3 e 240 caracteres. Fica gravado junto com a data de fechamento."
        >
          <Textarea
            required
            minLength={3}
            maxLength={240}
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Preco acima do orcamento do cliente"
          />
        </Field>
      </FormDialog>

      <DealFormDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function Column({
  stageKey,
  name,
  count,
  totalCents,
  deals,
  draggable,
}: {
  stageKey: string;
  name: string;
  count: number;
  totalCents: number;
  deals: Deal[];
  draggable: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stageKey });
  const terminal = stageKey === "won" || stageKey === "lost";

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-xl border transition-colors ${
        isOver ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-slate-50/70"
      }`}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          {stageKey === "won" && <Trophy size={13} className="text-emerald-600" />}
          {stageKey === "lost" && <XCircle size={13} className="text-rose-500" />}
          {name}
        </span>
        <Badge tone={terminal ? "muted" : "neutral"}>{count}</Badge>
      </header>
      <p className="px-3 pb-2 text-xs text-slate-500 tabular-nums">{formatMoney(totalCents)}</p>

      <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
        {deals.map((deal) => (
          <DraggableCard key={deal.id} deal={deal} draggable={draggable && deal.status === "open"} />
        ))}
        {deals.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-slate-400">
            {isOver ? "solte aqui" : "vazio"}
          </p>
        )}
      </div>
    </div>
  );
}

function DraggableCard({ deal, draggable }: { deal: Deal; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    data: { deal },
    disabled: !draggable,
  });

  return (
    <div ref={setNodeRef} className={isDragging ? "opacity-30" : undefined}>
      <Card deal={deal} handle={draggable ? { ...listeners, ...attributes } : undefined} />
    </div>
  );
}

function Card({
  deal,
  handle,
  overlay = false,
}: {
  deal: Deal;
  handle?: Record<string, unknown>;
  overlay?: boolean;
}) {
  return (
    <article
      className={`card p-2.5 ${overlay ? "rotate-2 shadow-lg" : "hover:border-slate-300"}`}
    >
      <div className="flex items-start gap-1.5">
        {handle && (
          <button
            type="button"
            {...handle}
            className="mt-0.5 shrink-0 cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
            aria-label="Arrastar negocio"
          >
            <GripVertical size={13} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <Link
            to={`/crm/negocios/${deal.id}`}
            className="block truncate text-sm font-medium text-slate-800 hover:text-brand-700"
          >
            {deal.title}
          </Link>
          <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
            {deal.amountFormatted} · {deal.probability}%
          </p>
          {deal.expectedCloseDate && (
            <p className="mt-0.5 text-[11px] text-slate-400">
              previsto para {formatDate(deal.expectedCloseDate)}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
