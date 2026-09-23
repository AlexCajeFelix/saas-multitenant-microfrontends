import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { iamApi } from "@saas/platform/api/iam";
import type { Role } from "@saas/platform/api/types";
import { useTenant } from "@saas/platform/lib/tenant";
import { useCan } from "@saas/platform/lib/permissions";
import { useApiMutation, fieldError, optional } from "@saas/platform/lib/mutations";
import { roleLabel } from "@saas/platform/lib/format";
import { PageHeader, Section } from "@saas/platform/components/PageHeader";
import { Badge } from "@saas/platform/components/ui/Badge";
import { Button, PermissionButton } from "@saas/platform/components/ui/Button";
import { Field, Input } from "@saas/platform/components/ui/Field";
import { ConfirmDialog, FormDialog } from "@saas/platform/components/ui/Dialog";
import { Spinner, QueryError } from "@saas/platform/components/ui/States";
import { Table, Th, Td, Tr } from "@saas/platform/components/ui/Table";

export function Roles() {
  const { tenantId } = useTenant();
  const canWrite = useCan("iam.role.write");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const roles = useQuery({ queryKey: ["roles", tenantId], queryFn: iamApi.listRoles });

  const create = useApiMutation({
    mutationFn: () =>
      iamApi.createRole({
        slug: slug.trim().toLowerCase(),
        name: name.trim(),
        description: optional(description),
      }),
    invalidate: [["roles", tenantId]],
    success: "Papel criado. Agora escolha as permissoes dele.",
    onDone: () => {
      setCreating(false);
      setSlug("");
      setName("");
      setDescription("");
    },
  });

  const remove = useApiMutation({
    mutationFn: (value: string) => iamApi.deleteRole(value),
    invalidate: [["roles", tenantId]],
    success: "Papel removido",
    onDone: () => setDeleting(null),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  if (roles.isPending) return <Spinner />;
  if (roles.isError) return <QueryError error={roles.error} />;

  const system = roles.data.filter((role) => role.isSystem);
  const custom = roles.data.filter((role) => !role.isSystem);

  return (
    <>
      <PageHeader
        title="Papeis"
        subtitle="Papeis de sistema valem para todos os tenants. Um papel proprio com o mesmo slug tem precedencia sobre o de sistema."
        actions={
          <PermissionButton
            permission="iam.role.write"
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => setCreating(true)}
          >
            Novo papel
          </PermissionButton>
        }
      />

      <div className="space-y-4">
        <RoleTable
          title="Deste tenant"
          description={custom.length ? undefined : "Nenhum papel proprio ainda."}
          roles={custom}
          onDelete={canWrite ? setDeleting : undefined}
        />
        <RoleTable
          title="De sistema"
          description="Vem das migrations e nao podem ser alterados."
          roles={system}
        />
      </div>

      <FormDialog
        open={creating}
        title="Novo papel"
        description="Voce so consegue conceder permissoes que ja possui."
        onClose={() => setCreating(false)}
        onSubmit={submit}
        submitLabel="Criar"
        submitting={create.isPending}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Slug"
            hint="minusculas, sem espaco"
            error={fieldError(create.error, "slug")}
          >
            <Input
              required
              autoFocus
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="suporte"
            />
          </Field>
          <Field label="Nome" error={fieldError(create.error, "name")}>
            <Input
              required
              minLength={2}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Suporte"
            />
          </Field>
        </div>
        <Field label="Descricao" error={fieldError(create.error, "description")}>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Atende chamados e le o CRM"
          />
        </Field>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remover papel"
        destructive
        confirmLabel="Remover"
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.slug)}
        message={`O papel ${deleting?.name} deixa de existir neste tenant.`}
      />
    </>
  );
}

function RoleTable({
  title,
  description,
  roles,
  onDelete,
}: {
  title: string;
  description?: string;
  roles: Role[];
  onDelete?: (role: Role) => void;
}) {
  return (
    <Section title={title} description={description}>
      {roles.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">
          <ShieldCheck size={18} className="mx-auto mb-1 text-slate-300" />
          Nada aqui.
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Papel</Th>
              <Th>Slug</Th>
              <Th>Escopo</Th>
              <Th align="right">Permissoes</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <Tr key={role.id}>
                <Td>
                  <Link
                    to={`/iam/papeis/${role.slug}`}
                    className="font-medium text-slate-800 hover:text-brand-700 hover:underline"
                  >
                    {roleLabel(role.slug) === role.slug ? role.name : roleLabel(role.slug)}
                  </Link>
                  {role.description && (
                    <span className="block truncate text-xs text-slate-500">
                      {role.description}
                    </span>
                  )}
                </Td>
                <Td>
                  <code className="font-mono text-xs text-slate-600">{role.slug}</code>
                </Td>
                <Td>
                  <Badge tone={role.scope === "system" ? "muted" : "brand"}>
                    {role.scope === "system" ? "sistema" : "tenant"}
                  </Badge>
                </Td>
                <Td align="right" className="tabular-nums">
                  {role.slug === "owner" ? "todas" : role.permissionCount}
                </Td>
                <Td align="right">
                  {onDelete && !role.isSystem && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 size={14} />}
                      title="Remover papel"
                      onClick={() => onDelete(role)}
                    />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Section>
  );
}
