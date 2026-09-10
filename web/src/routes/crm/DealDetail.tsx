import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MessageSquarePlus, Pencil, Trophy, XCircle } from "lucide-react";
import { crmApi } from "../../api/crm";
import type { ActivityKind } from "../../api/types";
import { useTenant } from "../../lib/tenant";
import { useApiMutation, fieldError } from "../../lib/mutations";
import {
  ACTIVITY_KIND_LABEL,
  DEAL_STATUS_LABEL,
  formatDate,
  formatDateTime,
  formatMoney,
  shortId,
} from "../../lib/format";
import { PageHeader, Section, Detail } from "../../components/PageHeader";
import { Badge, toneFor } from "../../components/ui/Badge";
import { PermissionButton } from "../../components/ui/Button";
import { Field, Input, Select, Textarea } from "../../components/ui/Field";
import { FormDialog } from "../../components/ui/Dialog";
import { Spinner, EmptyState, QueryError } from "../../components/ui/States";
import { DealFormDialog } from "./DealFormDialog";

const KINDS: ActivityKind[] = ["call", "email", "meeting", "note", "task"];

export function DealDetail() {
  const { id = "" } = useParams();
  const { tenantId } = useTenant();
  const [editing, setEditing] = useState(false);
  const [losing, setLosing] = useState(false);
  const [logging, setLogging] = useState(false);
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<ActivityKind>("note");
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");

  const deal = useQuery({
    queryKey: ["deal", tenantId, id],
    queryFn: () => crmApi.getDeal(id),
  });

  const invalidate = [["deal", tenantId, id], ["deals", tenantId], ["pipeline", tenantId]];

  const win = useApiMutation({
    mutationFn: () => crmApi.winDeal(id),
    invalidate,
    success: "Negocio ganho. A data de fechamento foi gravada.",
  });

  const lose = useApiMutation({
    mutationFn: () => crmApi.loseDeal(id, reason.trim()),
    invalidate,
    success: "Negocio perdido, com o motivo registrado",
    onDone: () => {
      setLosing(false);
      setReason("");
    },
  });

  const logActivity = useApiMutation({
    mutationFn: () =>
      crmApi.logActivity(id, { kind, subject: subject.trim(), notes: notes.trim() || undefined }),
    invalidate: [["deal", tenantId, id]],
    success: "Atividade registrada",
    onDone: () => {
      setLogging(false);
      setSubject("");
      setNotes("");
    },
  });

  const move = useApiMutation({
    mutationFn: (stageKey: string) => crmApi.moveDeal(id, stageKey),
    invalidate,
  });

  const pipeline = useQuery({ queryKey: ["pipeline", tenantId], queryFn: crmApi.pipeline });

  if (deal.isPending) return <Spinner />;
  if (deal.isError) return <QueryError error={deal.error} />;

  const data = deal.data;
  const open = data.status === "open";
  const activities = [...(data.activities ?? [])].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  return (
    <>
      <Link
        to="/crm/negocios"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={13} /> Negocios
      </Link>

      <PageHeader
        title={data.title}
        subtitle={`${data.amountFormatted} · ${data.probability}% de probabilidade · ${formatMoney(data.weightedCents, data.currency)} ponderado`}
        actions={
          <>
            <PermissionButton
              permission="crm.deal.write"
              icon={<Pencil size={15} />}
              onClick={() => setEditing(true)}
              disabled={!open}
              title={open ? undefined : "Negocio fechado nao aceita alteracao"}
            >
              Editar
            </PermissionButton>
            {open && (
              <>
                <PermissionButton
                  permission="crm.deal.write"
                  variant="danger"
                  icon={<XCircle size={15} />}
                  onClick={() => setLosing(true)}
                >
                  Perdido
                </PermissionButton>
                <PermissionButton
                  permission="crm.deal.write"
                  variant="primary"
                  icon={<Trophy size={15} />}
                  loading={win.isPending}
                  onClick={() => win.mutate()}
                >
                  Ganho
                </PermissionButton>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Section
            title="Atividades"
            description="Entram pelo agregado do negocio, nunca soltas."
            actions={
              <PermissionButton
                permission="crm.activity.write"
                size="sm"
                icon={<MessageSquarePlus size={14} />}
                onClick={() => setLogging(true)}
              >
                Registrar
              </PermissionButton>
            }
          >
            {activities.length === 0 ? (
              <EmptyState title="Nenhuma atividade" message="Ligacoes, e-mails e reunioes aparecem aqui." />
            ) : (
              <ol className="divide-y divide-slate-100">
                {activities.map((activity) => (
                  <li key={activity.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Badge tone="brand">{ACTIVITY_KIND_LABEL[activity.kind]}</Badge>
                      <span className="text-sm font-medium text-slate-800">{activity.subject}</span>
                      <span className="ml-auto text-xs text-slate-400">
                        {formatDateTime(activity.occurredAt)}
                      </span>
                    </div>
                    {activity.notes && (
                      <p className="mt-1 text-sm whitespace-pre-wrap text-slate-600">
                        {activity.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Situacao">
            <div className="space-y-3 p-4">
              <Badge tone={toneFor(data.status)}>{DEAL_STATUS_LABEL[data.status]}</Badge>

              {open ? (
                <Field label="Estagio" hint="Mudar de estagio adota a probabilidade do destino.">
                  <Select
                    value={data.stageKey}
                    disabled={move.isPending}
                    onChange={(event) => move.mutate(event.target.value)}
                  >
                    {(pipeline.data?.stages ?? [])
                      .filter((stage) => stage.stageKey !== "won" && stage.stageKey !== "lost")
                      .map((stage) => (
                        <option key={stage.stageKey} value={stage.stageKey}>
                          {stage.stageName}
                        </option>
                      ))}
                  </Select>
                </Field>
              ) : (
                <dl className="grid gap-3">
                  <Detail label="Fechado em">{formatDateTime(data.closedAt)}</Detail>
                  {data.lostReason && <Detail label="Motivo da perda">{data.lostReason}</Detail>}
                </dl>
              )}
            </div>
          </Section>

          <Section title="Dados">
            <dl className="grid gap-3 p-4">
              <Detail label="Previsao de fechamento">{formatDate(data.expectedCloseDate)}</Detail>
              <Detail label="Empresa">
                <span className="font-mono text-xs">{shortId(data.companyId)}</span>
              </Detail>
              <Detail label="Contato">
                <span className="font-mono text-xs">{shortId(data.contactId)}</span>
              </Detail>
              <Detail label="Responsavel">
                <span className="font-mono text-xs">{shortId(data.ownerId)}</span>
              </Detail>
              <Detail label="Criado em">{formatDateTime(data.createdAt)}</Detail>
            </dl>
          </Section>
        </div>
      </div>

      <DealFormDialog open={editing} onClose={() => setEditing(false)} deal={data} />

      <FormDialog
        open={losing}
        title="Marcar como perdido"
        onClose={() => setLosing(false)}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          lose.mutate();
        }}
        submitLabel="Registrar perda"
        submitting={lose.isPending}
      >
        <Field label="Motivo" hint="Entre 3 e 240 caracteres." error={fieldError(lose.error, "reason")}>
          <Textarea
            required
            autoFocus
            minLength={3}
            maxLength={240}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </FormDialog>

      <FormDialog
        open={logging}
        title="Registrar atividade"
        onClose={() => setLogging(false)}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          logActivity.mutate();
        }}
        submitLabel="Registrar"
        submitting={logActivity.isPending}
      >
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label="Tipo">
            <Select value={kind} onChange={(event) => setKind(event.target.value as ActivityKind)}>
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {ACTIVITY_KIND_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assunto" error={fieldError(logActivity.error, "subject")}>
            <Input
              required
              autoFocus
              minLength={2}
              maxLength={160}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Ligacao de acompanhamento"
            />
          </Field>
        </div>
        <Field label="Notas" error={fieldError(logActivity.error, "notes")}>
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </FormDialog>
    </>
  );
}
