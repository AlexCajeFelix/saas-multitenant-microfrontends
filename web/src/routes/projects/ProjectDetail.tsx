import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Archive, ArrowLeft, CheckCircle2, Circle, Flag, Plus } from "lucide-react";
import { projectsApi } from "../../api/projects";
import type { ProjectStatus } from "../../api/types";
import { useTenant } from "../../lib/tenant";
import { useApiMutation, fieldError, optional } from "../../lib/mutations";
import {
  formatDate,
  formatHours,
  PROJECT_STATUS_LABEL,
  shortId,
  TASK_STATUS_LABEL,
} from "../../lib/format";
import { PageHeader, Section, Detail } from "../../components/PageHeader";
import { Badge, toneFor } from "../../components/ui/Badge";
import { PermissionButton } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Field";
import { ConfirmDialog, FormDialog } from "../../components/ui/Dialog";
import { Spinner, EmptyState, QueryError } from "../../components/ui/States";
import { Table, Th, Td, Tr } from "../../components/ui/Table";
import { TaskFormDialog } from "./TaskFormDialog";

const STATUSES: ProjectStatus[] = ["planning", "active", "on_hold", "completed"];

export function ProjectDetail() {
  const { id = "" } = useParams();
  const { tenantId } = useTenant();
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [milestoneName, setMilestoneName] = useState("");
  const [milestoneDue, setMilestoneDue] = useState("");

  const project = useQuery({
    queryKey: ["project", tenantId, id],
    queryFn: () => projectsApi.getProject(id),
  });

  const summary = useQuery({
    queryKey: ["project-summary", tenantId, id],
    queryFn: () => projectsApi.projectSummary(id),
  });

  const tasks = useQuery({
    queryKey: ["tasks", tenantId, "of-project", id],
    queryFn: () => projectsApi.listTasks({ projectId: id, pageSize: 100, sort: "position", order: "asc" }),
  });

  const invalidate = [
    ["project", tenantId, id],
    ["project-summary", tenantId, id],
    ["projects", tenantId],
  ];

  const changeStatus = useApiMutation({
    mutationFn: (status: ProjectStatus) => projectsApi.changeProjectStatus(id, status),
    invalidate,
    success: "Situacao do projeto atualizada",
  });

  const archive = useApiMutation({
    mutationFn: () => projectsApi.archiveProject(id),
    invalidate,
    success: "Projeto arquivado: nao aceita mais trabalho novo",
    onDone: () => setArchiving(false),
  });

  const addMilestone = useApiMutation({
    mutationFn: () =>
      projectsApi.addMilestone(id, {
        name: milestoneName.trim(),
        dueDate: optional(milestoneDue),
      }),
    invalidate,
    success: "Marco criado",
    onDone: () => {
      setMilestoneOpen(false);
      setMilestoneName("");
      setMilestoneDue("");
    },
  });

  if (project.isPending) return <Spinner />;
  if (project.isError) return <QueryError error={project.error} />;

  const data = project.data;
  const archived = data.status === "archived";
  const milestones = [...(data.milestones ?? [])].sort((a, b) => a.position - b.position);

  return (
    <>
      <Link
        to="/projetos"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={13} /> Projetos
      </Link>

      <PageHeader
        title={data.name}
        subtitle={data.description || "Sem descricao."}
        actions={
          <>
            <PermissionButton
              permission="projects.task.write"
              icon={<Plus size={15} />}
              onClick={() => setTaskOpen(true)}
              disabled={archived}
              title={archived ? "Projeto arquivado nao aceita trabalho novo" : undefined}
            >
              Nova tarefa
            </PermissionButton>
            <PermissionButton
              permission="projects.project.write"
              variant="danger"
              icon={<Archive size={15} />}
              onClick={() => setArchiving(true)}
              disabled={archived}
            >
              {archived ? "Arquivado" : "Arquivar"}
            </PermissionButton>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Section
            title="Tarefas"
            description="Uma tarefa nao e concluida enquanto tiver subtarefa em aberto."
          >
            {tasks.isPending ? (
              <Spinner />
            ) : tasks.isError ? (
              <QueryError error={tasks.error} />
            ) : tasks.data.items.length === 0 ? (
              <EmptyState title="Nenhuma tarefa" message="Crie a primeira para comecar." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Tarefa</Th>
                    <Th>Situacao</Th>
                    <Th>Responsavel</Th>
                    <Th>Prazo</Th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.data.items.map((task) => (
                    <Tr key={task.id}>
                      <Td>
                        <Link
                          to={`/tarefas/${task.id}`}
                          className="font-medium text-slate-800 hover:text-brand-700"
                        >
                          {task.parentTaskId && <span className="mr-1 text-slate-300">↳</span>}
                          {task.title}
                        </Link>
                      </Td>
                      <Td>
                        <Badge tone={toneFor(task.status)}>{TASK_STATUS_LABEL[task.status]}</Badge>
                      </Td>
                      <Td>
                        <span className="font-mono text-xs text-slate-500">
                          {shortId(task.assigneeId)}
                        </span>
                      </Td>
                      <Td className="text-slate-500">{formatDate(task.dueDate)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Section>

          <Section
            title="Marcos"
            actions={
              <PermissionButton
                permission="projects.milestone.write"
                size="sm"
                icon={<Flag size={14} />}
                onClick={() => setMilestoneOpen(true)}
                disabled={archived}
              >
                Novo marco
              </PermissionButton>
            }
          >
            {milestones.length === 0 ? (
              <EmptyState title="Nenhum marco" message="Marcos ajudam a agrupar as entregas." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {milestones.map((milestone) => (
                  <li key={milestone.id} className="flex items-center gap-2.5 px-4 py-2.5">
                    {milestone.isCompleted ? (
                      <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
                    ) : (
                      <Circle size={15} className="shrink-0 text-slate-300" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                      {milestone.name}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {formatDate(milestone.dueDate)}
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
              <Badge tone={toneFor(data.status)}>{PROJECT_STATUS_LABEL[data.status]}</Badge>
              <Field label="Mudar para">
                <Select
                  value={data.status}
                  disabled={archived || changeStatus.isPending}
                  onChange={(event) => changeStatus.mutate(event.target.value as ProjectStatus)}
                >
                  {STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {PROJECT_STATUS_LABEL[value]}
                    </option>
                  ))}
                  {archived && <option value="archived">Arquivado</option>}
                </Select>
              </Field>
            </div>
          </Section>

          <Section title="Resumo">
            {summary.isPending ? (
              <Spinner />
            ) : summary.isError ? (
              <QueryError error={summary.error} />
            ) : (
              <dl className="grid gap-3 p-4">
                <Detail label="Horas apontadas">
                  {formatHours(summary.data.loggedMinutes)} de{" "}
                  {formatHours(summary.data.estimateMinutes)} estimadas
                </Detail>
                <Detail label="Tarefas por situacao">
                  <span className="flex flex-wrap gap-1">
                    {Object.entries(summary.data.tasks).map(([status, count]) => (
                      <Badge key={status} tone={toneFor(status)}>
                        {TASK_STATUS_LABEL[status] ?? status} {count}
                      </Badge>
                    ))}
                  </span>
                </Detail>
                <Detail label="Marcos">
                  <span className="flex flex-wrap gap-1">
                    {Object.entries(summary.data.milestones).map(([state, count]) => (
                      <Badge key={state} tone="neutral">
                        {state} {count}
                      </Badge>
                    ))}
                  </span>
                </Detail>
              </dl>
            )}
          </Section>

          <Section title="Dados">
            <dl className="grid gap-3 p-4">
              <Detail label="Codigo">
                <code className="font-mono text-xs">{data.code}</code>
              </Detail>
              <Detail label="Orcamento">{data.budgetFormatted}</Detail>
              <Detail label="Inicio">{formatDate(data.startDate)}</Detail>
              <Detail label="Prazo">{formatDate(data.dueDate)}</Detail>
              <Detail label="Cliente">
                <span className="font-mono text-xs">{shortId(data.clientCompanyId)}</span>
              </Detail>
            </dl>
          </Section>
        </div>
      </div>

      <FormDialog
        open={milestoneOpen}
        title="Novo marco"
        onClose={() => setMilestoneOpen(false)}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          addMilestone.mutate();
        }}
        submitLabel="Criar"
        submitting={addMilestone.isPending}
      >
        <Field label="Nome" error={fieldError(addMilestone.error, "name")}>
          <Input
            required
            autoFocus
            minLength={2}
            value={milestoneName}
            onChange={(event) => setMilestoneName(event.target.value)}
            placeholder="Entrega da primeira versao"
          />
        </Field>
        <Field label="Prazo" error={fieldError(addMilestone.error, "dueDate")}>
          <Input
            type="date"
            value={milestoneDue}
            onChange={(event) => setMilestoneDue(event.target.value)}
          />
        </Field>
      </FormDialog>

      <ConfirmDialog
        open={archiving}
        title="Arquivar projeto"
        destructive
        confirmLabel="Arquivar"
        loading={archive.isPending}
        onClose={() => setArchiving(false)}
        onConfirm={() => archive.mutate()}
        message="O projeto para de aceitar tarefas, comentarios e apontamento de horas."
      />

      <TaskFormDialog open={taskOpen} onClose={() => setTaskOpen(false)} projectId={id} />
    </>
  );
}
