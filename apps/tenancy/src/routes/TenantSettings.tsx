import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play, Save } from "lucide-react";
import { tenancyApi } from "@saas/platform/api/tenancy";
import { useTenant } from "@saas/platform/lib/tenant";
import { useApiMutation, fieldError } from "@saas/platform/lib/mutations";
import { formatDateTime, shortId, TENANT_STATUS_LABEL } from "@saas/platform/lib/format";
import { PageHeader, Section, Detail } from "@saas/platform/components/PageHeader";
import { Badge, toneFor } from "@saas/platform/components/ui/Badge";
import { PermissionButton } from "@saas/platform/components/ui/Button";
import { Field, Input } from "@saas/platform/components/ui/Field";
import { ConfirmDialog } from "@saas/platform/components/ui/Dialog";
import { Spinner, QueryError } from "@saas/platform/components/ui/States";

export function TenantSettings() {
  const { tenantId } = useTenant();
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<"suspend" | "activate" | null>(null);

  const tenant = useQuery({
    queryKey: ["tenant", tenantId],
    queryFn: () => tenancyApi.getTenant(tenantId!),
    enabled: Boolean(tenantId),
  });

  useEffect(() => {
    if (tenant.data) setName(tenant.data.name);
  }, [tenant.data]);

  const invalidate = [["tenant", tenantId], ["tenants"]];

  const rename = useApiMutation({
    mutationFn: () => tenancyApi.updateTenant(tenantId!, { name: name.trim() }),
    invalidate,
    success: "Tenant atualizado",
  });

  const suspend = useApiMutation({
    mutationFn: () => tenancyApi.suspendTenant(tenantId!),
    invalidate,
    success: "Tenant suspenso: as escritas passam a ser recusadas",
    onDone: () => setConfirming(null),
  });

  const activate = useApiMutation({
    mutationFn: () => tenancyApi.activateTenant(tenantId!),
    invalidate,
    success: "Tenant reativado",
    onDone: () => setConfirming(null),
  });

  if (tenant.isPending) return <Spinner />;
  if (tenant.isError) return <QueryError error={tenant.error} />;

  const data = tenant.data;
  const suspended = data.status !== "active";

  function submit(event: FormEvent) {
    event.preventDefault();
    rename.mutate();
  }

  return (
    <>
      <PageHeader
        title="Ajustes do tenant"
        subtitle="O slug e definido na criacao e nao muda; ele identifica o tenant em toda a base."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Section title="Identificacao">
          <form onSubmit={submit} className="space-y-4 p-4">
            <Field label="Nome" error={fieldError(rename.error, "name")}>
              <Input
                required
                minLength={2}
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Slug" hint="Imutavel.">
              <Input value={data.slug} disabled />
            </Field>
            <div className="flex justify-end">
              <PermissionButton
                permission="tenancy.tenant.write"
                type="submit"
                variant="primary"
                icon={<Save size={15} />}
                loading={rename.isPending}
                disabled={name.trim() === data.name}
              >
                Salvar
              </PermissionButton>
            </div>
          </form>
        </Section>

        <div className="space-y-4">
          <Section title="Situacao">
            <div className="space-y-3 p-4">
              <Badge tone={toneFor(data.status)}>{TENANT_STATUS_LABEL[data.status]}</Badge>
              <p className="text-xs text-slate-500">
                Um tenant suspenso continua legivel, mas o backend recusa toda escrita com 403.
              </p>
              {suspended ? (
                <PermissionButton
                  permission="tenancy.tenant.write"
                  variant="primary"
                  icon={<Play size={14} />}
                  onClick={() => setConfirming("activate")}
                  className="w-full"
                >
                  Reativar
                </PermissionButton>
              ) : (
                <PermissionButton
                  permission="tenancy.tenant.write"
                  variant="danger"
                  icon={<Pause size={14} />}
                  onClick={() => setConfirming("suspend")}
                  className="w-full"
                >
                  Suspender
                </PermissionButton>
              )}
            </div>
          </Section>

          <Section title="Metadados">
            <dl className="grid gap-3 p-4">
              <Detail label="Identificador">
                <span className="font-mono text-xs">{shortId(data.id)}</span>
              </Detail>
              <Detail label="Criado em">{formatDateTime(data.createdAt)}</Detail>
              <Detail label="Atualizado em">{formatDateTime(data.updatedAt)}</Detail>
              <Detail label="Criado por">
                <span className="font-mono text-xs">{shortId(data.createdBy)}</span>
              </Detail>
            </dl>
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={confirming === "suspend"}
        title="Suspender o tenant"
        destructive
        confirmLabel="Suspender"
        loading={suspend.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => suspend.mutate()}
        message="Ninguem consegue criar nem alterar nada enquanto durar a suspensao. A leitura continua."
      />

      <ConfirmDialog
        open={confirming === "activate"}
        title="Reativar o tenant"
        confirmLabel="Reativar"
        loading={activate.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => activate.mutate()}
        message="As escritas voltam a ser aceitas normalmente."
      />
    </>
  );
}
