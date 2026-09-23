import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "@saas/platform/api/projects";
import { tenancyApi } from "@saas/platform/api/tenancy";
import type { TaskPriority } from "@saas/platform/api/types";
import { useTenant } from "@saas/platform/lib/tenant";
import { useApiMutation, fieldError, optional } from "@saas/platform/lib/mutations";
import { roleLabel, shortId, TASK_PRIORITY_LABEL } from "@saas/platform/lib/format";
import { Field, Input, Select, Textarea } from "@saas/platform/components/ui/Field";
import { FormDialog } from "@saas/platform/components/ui/Dialog";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

/**
 * Criacao de tarefa, com ou sem projeto pre-escolhido. O responsavel sai da
 * lista de membros ativos: o backend confere isso pela porta MembershipDirectory
 * e recusa quem nao pertence ao tenant.
 */
export function TaskFormDialog({
  open,
  onClose,
  projectId,
  parentTaskId,
}: {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  parentTaskId?: string;
}) {
  const { tenantId } = useTenant();
  const [project, setProject] = useState(projectId ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [estimate, setEstimate] = useState("");

  useEffect(() => {
    if (!open) return;
    setProject(projectId ?? "");
    setTitle("");
    setDescription("");
    setPriority("medium");
    setAssigneeId("");
    setDueDate("");
    setEstimate("");
  }, [open, projectId]);

  const projects = useQuery({
    queryKey: ["projects", tenantId, "options"],
    queryFn: () => projectsApi.listProjects({ pageSize: 100, sort: "name", order: "asc" }),
    enabled: open && !projectId,
  });

  const members = useQuery({
    queryKey: ["members", tenantId, 1],
    queryFn: () => tenancyApi.listMembers({ page: 1, sort: "created_at", order: "asc" }),
    enabled: open,
  });

  const create = useApiMutation({
    mutationFn: () =>
      projectsApi.createTask({
        projectId: project,
        title: title.trim(),
        description: optional(description),
        parentTaskId,
        priority,
        assigneeId: optional(assigneeId),
        dueDate: optional(dueDate),
        estimateMinutes: estimate ? Number(estimate) : undefined,
      }),
    invalidate: [
      ["tasks", tenantId],
      ["project-summary", tenantId, project],
      ["task", tenantId, parentTaskId],
    ],
    success: parentTaskId ? "Subtarefa criada" : "Tarefa criada",
    onDone: onClose,
  });

  return (
    <FormDialog
      open={open}
      title={parentTaskId ? "Nova subtarefa" : "Nova tarefa"}
      onClose={onClose}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        create.mutate();
      }}
      submitLabel="Criar"
      submitting={create.isPending}
      disabled={!project}
    >
      {!projectId && (
        <Field label="Projeto" error={fieldError(create.error, "projectId")}>
          <Select required value={project} onChange={(event) => setProject(event.target.value)}>
            <option value="">selecione</option>
            {(projects.data?.items ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.code} · {option.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Titulo" error={fieldError(create.error, "title")}>
        <Input
          required
          autoFocus
          minLength={2}
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Modelar o catalogo de produtos"
        />
      </Field>

      <Field label="Descricao" error={fieldError(create.error, "description")}>
        <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Prioridade">
          <Select
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority)}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {TASK_PRIORITY_LABEL[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsavel" error={fieldError(create.error, "assigneeId")}>
          <Select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            <option value="">ninguem</option>
            {(members.data?.items ?? [])
              .filter((member) => member.status === "active")
              .map((member) => (
                <option key={member.id} value={member.userId}>
                  {shortId(member.userId)} · {roleLabel(member.role)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Prazo" error={fieldError(create.error, "dueDate")}>
          <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </Field>
        <Field
          label="Estimativa (minutos)"
          hint="De 1 a 1440."
          error={fieldError(create.error, "estimateMinutes")}
        >
          <Input
            type="number"
            min={1}
            max={1440}
            value={estimate}
            onChange={(event) => setEstimate(event.target.value)}
          />
        </Field>
      </div>
    </FormDialog>
  );
}
