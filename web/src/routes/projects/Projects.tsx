import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { FolderKanban, Plus, Search } from "lucide-react";
import { projectsApi, type ProjectInput } from "../../api/projects";
import { crmApi } from "../../api/crm";
import type { ProjectStatus } from "../../api/types";
import { useTenant } from "../../lib/tenant";
import { useApiMutation, fieldError, optional } from "../../lib/mutations";
import { formatDate, parseMoneyToCents, PROJECT_STATUS_LABEL } from "../../lib/format";
import { PageHeader, Section } from "../../components/PageHeader";
import { Badge, toneFor } from "../../components/ui/Badge";
import { PermissionButton } from "../../components/ui/Button";
import { Field, Input, MoneyInput, Select, Textarea } from "../../components/ui/Field";
import { FormDialog } from "../../components/ui/Dialog";
import { Spinner, EmptyState, QueryError } from "../../components/ui/States";
import { Table, Th, Td, Tr, Pagination } from "../../components/ui/Table";

const STATUSES: ProjectStatus[] = ["planning", "active", "on_hold", "completed", "archived"];

export function Projects() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "">("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ProjectInput & { budget: string }>({ name: "", budget: "" });

  const projects = useQuery({
    queryKey: ["projects", tenantId, page, search, status],
    queryFn: () =>
      projectsApi.listProjects({
        page,
        search: search || undefined,
        status: status || undefined,
        sort: "updated_at",
      }),
    placeholderData: keepPreviousData,
  });

  const companies = useQuery({
    queryKey: ["companies", tenantId, "options"],
    queryFn: () => crmApi.listCompanies({ pageSize: 100, sort: "name", order: "asc" }),
    enabled: creating,
  });

  const create = useApiMutation({
    mutationFn: () =>
      projectsApi.createProject({
        name: form.name.trim(),
        code: optional(form.code)?.toUpperCase(),
        description: optional(form.description),
        startDate: optional(form.startDate),
        dueDate: optional(form.dueDate),
        budgetCents: parseMoneyToCents(form.budget),
        clientCompanyId: optional(form.clientCompanyId),
      }),
    invalidate: [["projects", tenantId], ["subscription", tenantId]],
    success: "Projeto criado",
    onDone: (project) => {
      setCreating(false);
      setForm({ name: "", budget: "" });
      navigate(`/projetos/${project.id}`);
    },
  });

  return (
    <>
      <PageHeader
        title="Projetos"
        subtitle="Projeto arquivado nao aceita trabalho novo, e o responsavel precisa ser membro ativo do tenant."
        actions={
          <PermissionButton
            permission="projects.project.write"
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => setCreating(true)}
          >
            Novo projeto
          </PermissionButton>
        }
      />

      <Section>
        <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
          <div className="relative min-w-48 flex-1">
            <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Buscar por nome"
              className="pl-8"
            />
          </div>
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ProjectStatus | "");
              setPage(1);
            }}
            className="w-48"
          >
            <option value="">todas as situacoes</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {PROJECT_STATUS_LABEL[value]}
              </option>
            ))}
          </Select>
        </div>

        {projects.isPending ? (
          <Spinner />
        ) : projects.isError ? (
          <QueryError error={projects.error} />
        ) : projects.data.items.length === 0 ? (
          <EmptyState icon={<FolderKanban size={28} />} title="Nenhum projeto" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Codigo</Th>
                  <Th>Projeto</Th>
                  <Th>Situacao</Th>
                  <Th align="right">Orcamento</Th>
                  <Th>Prazo</Th>
                </tr>
              </thead>
              <tbody>
                {projects.data.items.map((project) => (
                  <Tr key={project.id} onClick={() => navigate(`/projetos/${project.id}`)}>
                    <Td>
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                        {project.code}
                      </code>
                    </Td>
                    <Td>
                      <Link
                        to={`/projetos/${project.id}`}
                        className="font-medium text-slate-800 hover:text-brand-700"
                      >
                        {project.name}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={toneFor(project.status)}>
                        {PROJECT_STATUS_LABEL[project.status]}
                      </Badge>
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {project.budgetFormatted}
                    </Td>
                    <Td className="text-slate-500">{formatDate(project.dueDate)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={projects.data} onChange={setPage} label="projetos" />
          </>
        )}
      </Section>

      <FormDialog
        open={creating}
        title="Novo projeto"
        description="O plano do tenant limita quantos projetos existem ao mesmo tempo."
        onClose={() => setCreating(false)}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          create.mutate();
        }}
        submitLabel="Criar"
        submitting={create.isPending}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <Field label="Nome" error={fieldError(create.error, "name")}>
            <Input
              required
              autoFocus
              minLength={2}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Sistema de PDV"
            />
          </Field>
          <Field label="Codigo" hint="Opcional" error={fieldError(create.error, "code")}>
            <Input
              value={form.code ?? ""}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
              placeholder="PDV"
              className="font-mono"
            />
          </Field>
        </div>

        <Field label="Descricao" error={fieldError(create.error, "description")}>
          <Textarea
            value={form.description ?? ""}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Inicio" error={fieldError(create.error, "startDate")}>
            <Input
              type="date"
              value={form.startDate ?? ""}
              onChange={(event) => setForm({ ...form, startDate: event.target.value })}
            />
          </Field>
          <Field label="Prazo" error={fieldError(create.error, "dueDate")}>
            <Input
              type="date"
              value={form.dueDate ?? ""}
              onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
            />
          </Field>
          <Field label="Orcamento (R$)" error={fieldError(create.error, "budgetCents")}>
            <MoneyInput
              value={form.budget}
              onChange={(event) => setForm({ ...form, budget: event.target.value })}
            />
          </Field>
        </div>

        <Field label="Cliente" error={fieldError(create.error, "clientCompanyId")}>
          <Select
            value={form.clientCompanyId ?? ""}
            onChange={(event) => setForm({ ...form, clientCompanyId: event.target.value })}
          >
            <option value="">nenhum</option>
            {(companies.data?.items ?? []).map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </Select>
        </Field>
      </FormDialog>
    </>
  );
}
