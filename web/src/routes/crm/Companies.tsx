import { useEffect, useState, type FormEvent } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { crmApi, type CompanyInput } from "../../api/crm";
import type { Company } from "../../api/types";
import { useTenant } from "../../lib/tenant";
import { useCan } from "../../lib/permissions";
import { useApiMutation, fieldError, optional } from "../../lib/mutations";
import { formatDate } from "../../lib/format";
import { PageHeader, Section } from "../../components/PageHeader";
import { Button, PermissionButton } from "../../components/ui/Button";
import { Field, Input } from "../../components/ui/Field";
import { ConfirmDialog, FormDialog } from "../../components/ui/Dialog";
import { Spinner, EmptyState, QueryError } from "../../components/ui/States";
import { Table, Th, Td, Tr, Pagination } from "../../components/ui/Table";

const BLANK: CompanyInput = { name: "" };

export function Companies() {
  const { tenantId } = useTenant();
  const canWrite = useCan("crm.company.write");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Company | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [form, setForm] = useState<CompanyInput>(BLANK);

  const companies = useQuery({
    queryKey: ["companies", tenantId, page, search],
    queryFn: () => crmApi.listCompanies({ page, search: search || undefined, sort: "name", order: "asc" }),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (creating) setForm(BLANK);
    else if (editing) {
      setForm({
        name: editing.name,
        domain: editing.domain ?? "",
        industry: editing.industry ?? "",
        website: editing.website ?? "",
        phone: editing.phone ?? "",
      });
    }
  }, [creating, editing]);

  const invalidate = [["companies", tenantId]];

  const save = useApiMutation({
    mutationFn: () => {
      const payload: CompanyInput = {
        name: form.name.trim(),
        domain: optional(form.domain),
        industry: optional(form.industry),
        website: optional(form.website),
        phone: optional(form.phone),
      };
      return editing ? crmApi.updateCompany(editing.id, payload) : crmApi.createCompany(payload);
    },
    invalidate,
    success: editing ? "Empresa atualizada" : "Empresa criada",
    onDone: () => {
      setCreating(false);
      setEditing(null);
    },
  });

  const remove = useApiMutation({
    mutationFn: (id: string) => crmApi.deleteCompany(id),
    invalidate,
    success: "Empresa removida",
    onDone: () => setDeleting(null),
  });

  const open = creating || Boolean(editing);

  return (
    <>
      <PageHeader
        title="Empresas"
        subtitle="Contas do CRM. Contatos e negocios se penduram nelas."
        actions={
          <PermissionButton
            permission="crm.company.write"
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => setCreating(true)}
          >
            Nova empresa
          </PermissionButton>
        }
      />

      <Section>
        <div className="border-b border-slate-200 p-3">
          <div className="relative">
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
        </div>

        {companies.isPending ? (
          <Spinner />
        ) : companies.isError ? (
          <QueryError error={companies.error} />
        ) : companies.data.items.length === 0 ? (
          <EmptyState icon={<Building2 size={28} />} title="Nenhuma empresa" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>Dominio</Th>
                  <Th>Setor</Th>
                  <Th>Telefone</Th>
                  <Th>Criada em</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {companies.data.items.map((company) => (
                  <Tr key={company.id}>
                    <Td className="font-medium text-slate-800">{company.name}</Td>
                    <Td className="text-slate-500">{company.domain ?? "—"}</Td>
                    <Td className="text-slate-500">{company.industry ?? "—"}</Td>
                    <Td className="text-slate-500">{company.phone ?? "—"}</Td>
                    <Td className="text-slate-500">{formatDate(company.createdAt)}</Td>
                    <Td align="right">
                      {canWrite && (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Pencil size={14} />}
                            title="Editar"
                            onClick={() => setEditing(company)}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 size={14} />}
                            title="Remover"
                            onClick={() => setDeleting(company)}
                          />
                        </div>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={companies.data} onChange={setPage} label="empresas" />
          </>
        )}
      </Section>

      <FormDialog
        open={open}
        title={editing ? "Editar empresa" : "Nova empresa"}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
        submitLabel={editing ? "Salvar" : "Criar"}
        submitting={save.isPending}
      >
        <Field label="Nome" error={fieldError(save.error, "name")}>
          <Input
            required
            autoFocus
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Acme Industria"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dominio" error={fieldError(save.error, "domain")}>
            <Input
              value={form.domain ?? ""}
              onChange={(event) => setForm({ ...form, domain: event.target.value })}
              placeholder="acme.com"
            />
          </Field>
          <Field label="Setor" error={fieldError(save.error, "industry")}>
            <Input
              value={form.industry ?? ""}
              onChange={(event) => setForm({ ...form, industry: event.target.value })}
              placeholder="Industria"
            />
          </Field>
          <Field label="Site" error={fieldError(save.error, "website")}>
            <Input
              value={form.website ?? ""}
              onChange={(event) => setForm({ ...form, website: event.target.value })}
              placeholder="https://acme.com"
            />
          </Field>
          <Field label="Telefone" error={fieldError(save.error, "phone")}>
            <Input
              value={form.phone ?? ""}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              placeholder="(11) 4000-0000"
            />
          </Field>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remover empresa"
        destructive
        confirmLabel="Remover"
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        message={`${deleting?.name} sai da base do CRM deste tenant.`}
      />
    </>
  );
}
