import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { CheckSquare, Plus, Search } from "lucide-react";
import { projectsApi } from "@saas/platform/api/projects";
import type { TaskStatus } from "@saas/platform/api/types";
import { useTenant } from "@saas/platform/lib/tenant";
import { useAuth } from "@saas/platform/lib/auth";
import {
  formatDate,
  shortId,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
} from "@saas/platform/lib/format";
import { PageHeader, Section } from "@saas/platform/components/PageHeader";
import { Badge, toneFor } from "@saas/platform/components/ui/Badge";
import { Button, PermissionButton } from "@saas/platform/components/ui/Button";
import { Input, Select } from "@saas/platform/components/ui/Field";
import { Spinner, EmptyState, QueryError } from "@saas/platform/components/ui/States";
import { Table, Th, Td, Tr, Pagination } from "@saas/platform/components/ui/Table";
import { TaskFormDialog } from "./TaskFormDialog";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done", "cancelled"];

export function Tasks() {
  const { tenantId } = useTenant();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [projectId, setProjectId] = useState("");
  const [mine, setMine] = useState(false);
  const [creating, setCreating] = useState(false);

  const tasks = useQuery({
    queryKey: ["tasks", tenantId, page, search, status, projectId, mine],
    queryFn: () =>
      projectsApi.listTasks({
        page,
        search: search || undefined,
        status: status || undefined,
        projectId: projectId || undefined,
        assigneeId: mine ? session?.userId : undefined,
        sort: "updated_at",
      }),
    placeholderData: keepPreviousData,
  });

  const projects = useQuery({
    queryKey: ["projects", tenantId, "options"],
    queryFn: () => projectsApi.listProjects({ pageSize: 100, sort: "name", order: "asc" }),
  });

  const projectName = new Map((projects.data?.items ?? []).map((p) => [p.id, p.code]));

  return (
    <>
      <PageHeader
        title="Tarefas"
        subtitle="Todas as tarefas do tenant, de todos os projetos."
        actions={
          <PermissionButton
            permission="projects.task.write"
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => setCreating(true)}
          >
            Nova tarefa
          </PermissionButton>
        }
      />

      <Section>
        <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
          <div className="relative min-w-44 flex-1">
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
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setPage(1);
            }}
            className="w-44"
          >
            <option value="">todos os projetos</option>
            {(projects.data?.items ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.name}
              </option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as TaskStatus | "");
              setPage(1);
            }}
            className="w-40"
          >
            <option value="">todas as situacoes</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {TASK_STATUS_LABEL[value]}
              </option>
            ))}
          </Select>
          <Button
            variant={mine ? "primary" : "secondary"}
            onClick={() => {
              setMine(!mine);
              setPage(1);
            }}
          >
            Minhas
          </Button>
        </div>

        {tasks.isPending ? (
          <Spinner />
        ) : tasks.isError ? (
          <QueryError error={tasks.error} />
        ) : tasks.data.items.length === 0 ? (
          <EmptyState icon={<CheckSquare size={28} />} title="Nenhuma tarefa encontrada" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Tarefa</Th>
                  <Th>Projeto</Th>
                  <Th>Situacao</Th>
                  <Th>Prioridade</Th>
                  <Th>Responsavel</Th>
                  <Th>Prazo</Th>
                </tr>
              </thead>
              <tbody>
                {tasks.data.items.map((task) => (
                  <Tr key={task.id} onClick={() => navigate(`/tarefas/${task.id}`)}>
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
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                        {projectName.get(task.projectId) ?? shortId(task.projectId)}
                      </code>
                    </Td>
                    <Td>
                      <Badge tone={toneFor(task.status)}>{TASK_STATUS_LABEL[task.status]}</Badge>
                    </Td>
                    <Td className="text-slate-500">{TASK_PRIORITY_LABEL[task.priority]}</Td>
                    <Td>
                      <span className="font-mono text-xs text-slate-500">
                        {task.assigneeId === session?.userId ? "voce" : shortId(task.assigneeId)}
                      </span>
                    </Td>
                    <Td className="text-slate-500">{formatDate(task.dueDate)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={tasks.data} onChange={setPage} label="tarefas" />
          </>
        )}
      </Section>

      <TaskFormDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
