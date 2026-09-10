import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Clock, ListPlus, MessageSquarePlus } from "lucide-react";
import { projectsApi } from "../../api/projects";
import { tenancyApi } from "../../api/tenancy";
import type { TaskStatus } from "../../api/types";
import { useTenant } from "../../lib/tenant";
import { useAuth } from "../../lib/auth";
import { useApiMutation, fieldError, optional } from "../../lib/mutations";
import {
  formatDate,
  formatDateTime,
  formatHours,
  roleLabel,
  shortId,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
} from "../../lib/format";
import { PageHeader, Section, Detail } from "../../components/PageHeader";
import { Badge, toneFor } from "../../components/ui/Badge";
import { PermissionButton } from "../../components/ui/Button";
import { Field, Input, Select, Textarea } from "../../components/ui/Field";
import { FormDialog } from "../../components/ui/Dialog";
import { Spinner, EmptyState, QueryError } from "../../components/ui/States";
import { TaskFormDialog } from "./TaskFormDialog";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done", "cancelled"];

export function TaskDetail() {
  const { id = "" } = useParams();
  const { tenantId } = useTenant();
  const { session } = useAuth();
  const [commenting, setCommenting] = useState(false);
  const [logging, setLogging] = useState(false);
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [spentOn, setSpentOn] = useState("");
  const [notes, setNotes] = useState("");

  const task = useQuery({
    queryKey: ["task", tenantId, id],
    queryFn: () => projectsApi.getTask(id),
  });

  const subtasks = useQuery({
    queryKey: ["tasks", tenantId, "subtasks", id],
    queryFn: () => projectsApi.listTasks({ parentTaskId: id, pageSize: 100 }),
  });

  const members = useQuery({
    queryKey: ["members", tenantId, 1],
    queryFn: () => tenancyApi.listMembers({ page: 1, sort: "created_at", order: "asc" }),
  });

  const projectId = task.data?.projectId;
  const invalidate = [
    ["task", tenantId, id],
    ["tasks", tenantId],
    ["project-summary", tenantId, projectId],
  ];

  const changeStatus = useApiMutation({
    mutationFn: (status: TaskStatus) => projectsApi.changeTaskStatus(id, status),
    invalidate,
    success: "Situacao da tarefa atualizada",
  });

  const assign = useApiMutation({
    mutationFn: (assigneeId: string) => projectsApi.assignTask(id, assigneeId || undefined),
    invalidate,
    success: "Responsavel atualizado",
  });

  const addComment = useApiMutation({
    mutationFn: () => projectsApi.commentTask(id, comment.trim()),
    invalidate: [["task", tenantId, id]],
    success: "Comentario publicado",
    onDone: () => {
      setCommenting(false);
      setComment("");
    },
  });

  const logTime = useApiMutation({
    mutationFn: () =>
      projectsApi.logTime(id, {
        minutes: Number(minutes),
        spentOn: optional(spentOn),
        notes: optional(notes),
      }),
    invalidate,
    success: "Horas apontadas",
    onDone: () => {
      setLogging(false);
      setNotes("");
    },
  });

  if (task.isPending) return <Spinner />;
  if (task.isError) return <QueryError error={task.error} />;

  const data = task.data;
  const openSubtasks = (subtasks.data?.items ?? []).filter(
    (subtask) => subtask.status !== "done" && subtask.status !== "cancelled",
  );
  const comments = [...(data.comments ?? [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const entries = [...(data.timeEntries ?? [])].sort((a, b) => b.spentOn.localeCompare(a.spentOn));

  return (
    <>
      <Link
        to={projectId ? `/projetos/${projectId}` : "/tarefas"}
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={13} /> {projectId ? "Projeto" : "Tarefas"}
      </Link>

      <PageHeader
        title={data.title}
        subtitle={data.description || "Sem descricao."}
        actions={
          <PermissionButton
            permission="projects.task.write"
            icon={<ListPlus size={15} />}
            onClick={() => setSubtaskOpen(true)}
          >
            Nova subtarefa
          </PermissionButton>
        }
      />

      {openSubtasks.length > 0 && (
        <p className="card mb-4 border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          Esta tarefa tem {openSubtasks.length} subtarefa(s) em aberto. O dominio recusa conclui-la
          enquanto for assim.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Section
            title="Comentarios"
            actions={
              <PermissionButton
                permission="projects.comment.write"
                size="sm"
                icon={<MessageSquarePlus size={14} />}
                onClick={() => setCommenting(true)}
              >
                Comentar
              </PermissionButton>
            }
          >
            {comments.length === 0 ? (
              <EmptyState title="Nenhum comentario" />
            ) : (
              <ol className="divide-y divide-slate-100">
                {comments.map((entry) => (
                  <li key={entry.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-xs text-slate-500">
                        {entry.authorId === session?.userId ? "voce" : shortId(entry.authorId)}
                      </span>
                      <span className="text-xs text-slate-400">
                        {formatDateTime(entry.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700">{entry.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section
            title="Subtarefas"
            description="Uma tarefa nao e concluida enquanto tiver subtarefa em aberto."
          >
            {subtasks.isPending ? (
              <Spinner />
            ) : (subtasks.data?.items.length ?? 0) === 0 ? (
              <EmptyState title="Nenhuma subtarefa" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {subtasks.data!.items.map((subtask) => (
                  <li key={subtask.id} className="flex items-center gap-2.5 px-4 py-2.5">
                    <Link
                      to={`/tarefas/${subtask.id}`}
                      className="min-w-0 flex-1 truncate text-sm text-slate-700 hover:text-brand-700"
                    >
                      {subtask.title}
                    </Link>
                    <Badge tone={toneFor(subtask.status)}>
                      {TASK_STATUS_LABEL[subtask.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Apontamento de horas"
            description={`${formatHours(data.loggedMinutes ?? 0)} lancadas de ${formatHours(data.estimateMinutes)} estimadas.`}
            actions={
              <PermissionButton
                permission="projects.time_entry.write"
                size="sm"
                icon={<Clock size={14} />}
                onClick={() => setLogging(true)}
              >
                Apontar
              </PermissionButton>
            }
          >
            {entries.length === 0 ? (
              <EmptyState title="Nenhuma hora apontada" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {entries.map((entry) => (
                  <li key={entry.id} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
                    <span className="shrink-0 font-medium text-slate-700 tabular-nums">
                      {formatHours(entry.minutes)}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {formatDate(entry.spentOn)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-slate-600">
                      {entry.notes || "—"}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-slate-400">
                      {entry.userId === session?.userId ? "voce" : shortId(entry.userId)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Situacao">
            <div className="space-y-3 p-4">
              <Badge tone={toneFor(data.status)}>{TASK_STATUS_LABEL[data.status]}</Badge>
              <Field label="Mudar para">
                <Select
                  value={data.status}
                  disabled={changeStatus.isPending}
                  onChange={(event) => changeStatus.mutate(event.target.value as TaskStatus)}
                >
                  {STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {TASK_STATUS_LABEL[value]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Responsavel" hint="Somente membros ativos do tenant.">
                <Select
                  value={data.assigneeId ?? ""}
                  disabled={assign.isPending}
                  onChange={(event) => assign.mutate(event.target.value)}
                >
                  <option value="">ninguem</option>
                  {(members.data?.items ?? [])
                    .filter((member) => member.status === "active")
                    .map((member) => (
                      <option key={member.id} value={member.userId}>
                        {member.userId === session?.userId ? "voce" : shortId(member.userId)} ·{" "}
                        {roleLabel(member.role)}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
          </Section>

          <Section title="Dados">
            <dl className="grid gap-3 p-4">
              <Detail label="Prioridade">{TASK_PRIORITY_LABEL[data.priority]}</Detail>
              <Detail label="Prazo">{formatDate(data.dueDate)}</Detail>
              <Detail label="Estimativa">{formatHours(data.estimateMinutes)}</Detail>
              <Detail label="Concluida em">{formatDateTime(data.completedAt)}</Detail>
              <Detail label="Criada em">{formatDateTime(data.createdAt)}</Detail>
            </dl>
          </Section>
        </div>
      </div>

      <FormDialog
        open={commenting}
        title="Comentar na tarefa"
        onClose={() => setCommenting(false)}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          addComment.mutate();
        }}
        submitLabel="Publicar"
        submitting={addComment.isPending}
      >
        <Field label="Comentario" error={fieldError(addComment.error, "body")}>
          <Textarea
            required
            autoFocus
            rows={4}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </Field>
      </FormDialog>

      <FormDialog
        open={logging}
        title="Apontar horas"
        onClose={() => setLogging(false)}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          logTime.mutate();
        }}
        submitLabel="Apontar"
        submitting={logTime.isPending}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Minutos" hint="De 1 a 1440." error={fieldError(logTime.error, "minutes")}>
            <Input
              type="number"
              required
              autoFocus
              min={1}
              max={1440}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </Field>
          <Field label="Data" error={fieldError(logTime.error, "spentOn")}>
            <Input
              type="date"
              value={spentOn}
              onChange={(event) => setSpentOn(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Notas" error={fieldError(logTime.error, "notes")}>
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </FormDialog>

      <TaskFormDialog
        open={subtaskOpen}
        onClose={() => setSubtaskOpen(false)}
        projectId={data.projectId}
        parentTaskId={data.id}
      />
    </>
  );
}
