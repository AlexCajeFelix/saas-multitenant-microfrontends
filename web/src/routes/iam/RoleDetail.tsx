import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Lock, Save, UserPlus } from "lucide-react";
import { iamApi } from "../../api/iam";
import { tenancyApi } from "../../api/tenancy";
import { useTenant } from "../../lib/tenant";
import { usePermissions, useCan } from "../../lib/permissions";
import { useApiMutation } from "../../lib/mutations";
import { formatDateTime, roleLabel, shortId } from "../../lib/format";
import { PageHeader, Section } from "../../components/PageHeader";
import { Badge } from "../../components/ui/Badge";
import { Button, PermissionButton } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Field";
import { FormDialog } from "../../components/ui/Dialog";
import { Spinner, QueryError } from "../../components/ui/States";

export function RoleDetail() {
  const { slug = "" } = useParams();
  const { tenantId } = useTenant();
  const { can } = usePermissions();
  const canWrite = useCan("iam.role.write");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [userId, setUserId] = useState("");

  const role = useQuery({
    queryKey: ["role", tenantId, slug],
    queryFn: () => iamApi.getRole(slug),
  });

  const catalog = useQuery({
    queryKey: ["permissions", tenantId],
    queryFn: iamApi.permissions,
    staleTime: 5 * 60_000,
  });

  const members = useQuery({
    queryKey: ["members", tenantId, 1],
    queryFn: () => tenancyApi.listMembers({ page: 1, sort: "created_at", order: "asc" }),
    enabled: assigning,
  });

  useEffect(() => {
    if (role.data) setSelected(new Set(role.data.permissions));
  }, [role.data]);

  const save = useApiMutation({
    // Trocar o conjunto de permissoes e atomico do lado do banco. A rota
    // DELETE /roles/:slug/permissions responde 200 sem revogar nada, entao a
    // substituicao inteira vai por PATCH.
    mutationFn: () => iamApi.updateRole(slug, { permissions: [...selected].sort() }),
    invalidate: [["role", tenantId, slug], ["roles", tenantId], ["whoami", tenantId]],
    success: "Permissoes do papel atualizadas",
  });

  const assign = useApiMutation({
    mutationFn: () => iamApi.assignRole(userId, slug),
    invalidate: [["members", tenantId], ["whoami", tenantId]],
    success: "Papel atribuido ao membro",
    onDone: () => {
      setAssigning(false);
      setUserId("");
    },
  });

  const original = useMemo(() => new Set(role.data?.permissions ?? []), [role.data]);
  const dirty = useMemo(() => {
    if (original.size !== selected.size) return true;
    for (const permission of selected) if (!original.has(permission)) return true;
    return false;
  }, [original, selected]);

  if (role.isPending) return <Spinner />;
  if (role.isError) return <QueryError error={role.error} />;

  const data = role.data;
  const locked = data.isSystem || !canWrite;

  function toggle(permission: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  return (
    <>
      <Link
        to="/iam/papeis"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={13} /> Papeis
      </Link>

      <PageHeader
        title={data.name}
        subtitle={data.description || "Sem descricao."}
        actions={
          <>
            <PermissionButton
              permission="iam.role.write"
              variant="secondary"
              icon={<UserPlus size={15} />}
              onClick={() => setAssigning(true)}
            >
              Atribuir a um membro
            </PermissionButton>
            <Button
              variant="primary"
              icon={<Save size={15} />}
              loading={save.isPending}
              disabled={locked || !dirty}
              title={data.isSystem ? "Papel de sistema nao muda" : undefined}
              onClick={() => save.mutate()}
            >
              Salvar permissoes
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-600">
          {data.slug}
        </code>
        <Badge tone={data.scope === "system" ? "muted" : "brand"}>
          {data.scope === "system" ? "papel de sistema" : "papel deste tenant"}
        </Badge>
        <span>{selected.size} permissoes selecionadas</span>
        <span>· atualizado em {formatDateTime(data.updatedAt)}</span>
      </div>

      {data.slug === "owner" && (
        <p className="card mb-4 border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          O dono recebe tudo por atalho na propria funcao de autorizacao. Permissoes criadas depois
          ja o alcancam, independentemente do que estiver marcado aqui.
        </p>
      )}

      {catalog.isPending ? (
        <Spinner />
      ) : catalog.isError ? (
        <QueryError error={catalog.error} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {catalog.data.modules.map((group) => (
            <Section key={group.module} title={group.module}>
              <ul className="divide-y divide-slate-100">
                {group.permissions.map((permission) => {
                  // Ninguem concede a um papel permissao que nao possui.
                  const grantable = can(permission.slug);
                  const disabled = locked || !grantable;
                  return (
                    <li key={permission.slug}>
                      <label
                        className={`flex items-start gap-2.5 px-4 py-2 ${
                          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-slate-50"
                        }`}
                        title={
                          !grantable
                            ? "Voce nao pode conceder uma permissao que nao possui"
                            : undefined
                        }
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 size-3.5 shrink-0 accent-indigo-600"
                          checked={selected.has(permission.slug)}
                          disabled={disabled}
                          onChange={() => toggle(permission.slug)}
                        />
                        <span className="min-w-0 flex-1">
                          <code className="font-mono text-xs text-slate-700">
                            {permission.slug}
                          </code>
                          <span className="block text-xs text-slate-500">
                            {permission.description}
                          </span>
                        </span>
                        {!grantable && <Lock size={12} className="mt-0.5 shrink-0 text-slate-300" />}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ))}
        </div>
      )}

      <FormDialog
        open={assigning}
        title={`Atribuir ${data.name}`}
        description="Troca o papel do membro neste tenant."
        onClose={() => setAssigning(false)}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          assign.mutate();
        }}
        submitLabel="Atribuir"
        submitting={assign.isPending}
        disabled={!userId}
      >
        <Field label="Membro" hint="A lista mostra os vinculos ativos deste tenant.">
          {members.isPending ? (
            <Input disabled value="carregando" />
          ) : (
            <Select value={userId} onChange={(event) => setUserId(event.target.value)}>
              <option value="">selecione</option>
              {(members.data?.items ?? [])
                .filter((member) => member.status === "active")
                .map((member) => (
                  <option key={member.id} value={member.userId}>
                    {shortId(member.userId)} · {roleLabel(member.role)}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      </FormDialog>
    </>
  );
}
