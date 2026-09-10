import { useEffect, useState, type FormEvent } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Contact as ContactIcon, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { crmApi, type ContactInput } from "../../api/crm";
import type { Contact } from "../../api/types";
import { useTenant } from "../../lib/tenant";
import { useCan } from "../../lib/permissions";
import { useApiMutation, fieldError, optional } from "../../lib/mutations";
import { PageHeader, Section } from "../../components/PageHeader";
import { Button, PermissionButton } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Field";
import { ConfirmDialog, FormDialog } from "../../components/ui/Dialog";
import { Spinner, EmptyState, QueryError } from "../../components/ui/States";
import { Table, Th, Td, Tr, Pagination } from "../../components/ui/Table";

const BLANK: ContactInput = { firstName: "" };

export function Contacts() {
  const { tenantId } = useTenant();
  const canWrite = useCan("crm.contact.write");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [form, setForm] = useState<ContactInput>(BLANK);

  const contacts = useQuery({
    queryKey: ["contacts", tenantId, page, search],
    queryFn: () =>
      crmApi.listContacts({ page, search: search || undefined, sort: "first_name", order: "asc" }),
    placeholderData: keepPreviousData,
  });

  const companies = useQuery({
    queryKey: ["companies", tenantId, "options"],
    queryFn: () => crmApi.listCompanies({ pageSize: 100, sort: "name", order: "asc" }),
    enabled: creating || Boolean(editing),
  });

  useEffect(() => {
    if (creating) setForm(BLANK);
    else if (editing) {
      setForm({
        firstName: editing.firstName,
        lastName: editing.lastName,
        email: editing.email ?? "",
        phone: editing.phone ?? "",
        jobTitle: editing.jobTitle ?? "",
        companyId: editing.companyId ?? "",
      });
    }
  }, [creating, editing]);

  const invalidate = [["contacts", tenantId]];

  const save = useApiMutation({
    mutationFn: () => {
      const payload: ContactInput = {
        firstName: form.firstName.trim(),
        lastName: optional(form.lastName),
        email: optional(form.email),
        phone: optional(form.phone),
        jobTitle: optional(form.jobTitle),
        companyId: optional(form.companyId),
      };
      return editing ? crmApi.updateContact(editing.id, payload) : crmApi.createContact(payload);
    },
    invalidate,
    success: editing ? "Contato atualizado" : "Contato criado",
    onDone: () => {
      setCreating(false);
      setEditing(null);
    },
  });

  const remove = useApiMutation({
    mutationFn: (id: string) => crmApi.deleteContact(id),
    invalidate,
    success: "Contato removido",
    onDone: () => setDeleting(null),
  });

  const open = creating || Boolean(editing);

  return (
    <>
      <PageHeader
        title="Contatos"
        subtitle="Pessoas do CRM, opcionalmente ligadas a uma empresa."
        actions={
          <PermissionButton
            permission="crm.contact.write"
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => setCreating(true)}
          >
            Novo contato
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

        {contacts.isPending ? (
          <Spinner />
        ) : contacts.isError ? (
          <QueryError error={contacts.error} />
        ) : contacts.data.items.length === 0 ? (
          <EmptyState icon={<ContactIcon size={28} />} title="Nenhum contato" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>Cargo</Th>
                  <Th>E-mail</Th>
                  <Th>Telefone</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {contacts.data.items.map((contact) => (
                  <Tr key={contact.id}>
                    <Td className="font-medium text-slate-800">{contact.fullName}</Td>
                    <Td className="text-slate-500">{contact.jobTitle ?? "—"}</Td>
                    <Td className="text-slate-500">{contact.email ?? "—"}</Td>
                    <Td className="text-slate-500">{contact.phone ?? "—"}</Td>
                    <Td align="right">
                      {canWrite && (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Pencil size={14} />}
                            title="Editar"
                            onClick={() => setEditing(contact)}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 size={14} />}
                            title="Remover"
                            onClick={() => setDeleting(contact)}
                          />
                        </div>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={contacts.data} onChange={setPage} label="contatos" />
          </>
        )}
      </Section>

      <FormDialog
        open={open}
        title={editing ? "Editar contato" : "Novo contato"}
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" error={fieldError(save.error, "firstName")}>
            <Input
              required
              autoFocus
              value={form.firstName}
              onChange={(event) => setForm({ ...form, firstName: event.target.value })}
            />
          </Field>
          <Field label="Sobrenome" error={fieldError(save.error, "lastName")}>
            <Input
              value={form.lastName ?? ""}
              onChange={(event) => setForm({ ...form, lastName: event.target.value })}
            />
          </Field>
          <Field label="E-mail" error={fieldError(save.error, "email")}>
            <Input
              type="email"
              value={form.email ?? ""}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
          <Field label="Telefone" error={fieldError(save.error, "phone")}>
            <Input
              value={form.phone ?? ""}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cargo" error={fieldError(save.error, "jobTitle")}>
            <Input
              value={form.jobTitle ?? ""}
              onChange={(event) => setForm({ ...form, jobTitle: event.target.value })}
              placeholder="Diretora de operacoes"
            />
          </Field>
          <Field label="Empresa" error={fieldError(save.error, "companyId")}>
            <Select
              value={form.companyId ?? ""}
              onChange={(event) => setForm({ ...form, companyId: event.target.value })}
            >
              <option value="">nenhuma</option>
              {(companies.data?.items ?? []).map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remover contato"
        destructive
        confirmLabel="Remover"
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        message={`${deleting?.fullName} sai da base do CRM deste tenant.`}
      />
    </>
  );
}
