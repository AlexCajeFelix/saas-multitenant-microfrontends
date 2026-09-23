import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { iamApi } from "@saas/platform/api/iam";
import type { ApiKey, CreatedApiKey } from "@saas/platform/api/types";
import { useTenant } from "@saas/platform/lib/tenant";
import { usePermissions, useCan } from "@saas/platform/lib/permissions";
import { useApiMutation, fieldError } from "@saas/platform/lib/mutations";
import { formatDateTime } from "@saas/platform/lib/format";
import { PageHeader, Section } from "@saas/platform/components/PageHeader";
import { Badge, toneFor } from "@saas/platform/components/ui/Badge";
import { Button, PermissionButton } from "@saas/platform/components/ui/Button";
import { Field, Input } from "@saas/platform/components/ui/Field";
import { ConfirmDialog, Dialog, FormDialog } from "@saas/platform/components/ui/Dialog";
import { Spinner, EmptyState, QueryError } from "@saas/platform/components/ui/States";
import { Table, Th, Td, Tr, Pagination } from "@saas/platform/components/ui/Table";

export function ApiKeys() {
  const { tenantId } = useTenant();
  const { can } = usePermissions();
  const canWrite = useCan("iam.api_key.write");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<CreatedApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set());

  const keys = useQuery({
    queryKey: ["api-keys", tenantId, page],
    queryFn: () => iamApi.listApiKeys({ page }),
  });

  const catalog = useQuery({
    queryKey: ["permissions", tenantId],
    queryFn: iamApi.permissions,
    enabled: creating,
    staleTime: 5 * 60_000,
  });

  const create = useApiMutation({
    mutationFn: () => iamApi.createApiKey({ name: name.trim(), scopes: [...scopes].sort() }),
    invalidate: [["api-keys", tenantId]],
    onDone: (key) => {
      setCreating(false);
      setName("");
      setScopes(new Set());
      setIssued(key);
    },
  });

  const revoke = useApiMutation({
    mutationFn: (id: string) => iamApi.revokeApiKey(id),
    invalidate: [["api-keys", tenantId]],
    success: "Chave revogada",
    onDone: () => setRevoking(null),
  });

  function toggleScope(permission: string) {
    setScopes((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  return (
    <>
      <PageHeader
        title="Chaves de API"
        subtitle="Uma chave nunca carrega permissao que quem a emitiu nao possui. O segredo aparece uma unica vez."
        actions={
          <PermissionButton
            permission="iam.api_key.write"
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => setCreating(true)}
          >
            Emitir chave
          </PermissionButton>
        }
      />

      <Section>
        {keys.isPending ? (
          <Spinner />
        ) : keys.isError ? (
          <QueryError error={keys.error} />
        ) : keys.data.items.length === 0 ? (
          <EmptyState
            icon={<KeyRound size={28} />}
            title="Nenhuma chave emitida"
            message="Chaves servem para integracoes que falam com a API sem um usuario."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>Prefixo</Th>
                  <Th align="right">Escopos</Th>
                  <Th>Situacao</Th>
                  <Th>Ultimo uso</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {keys.data.items.map((key) => (
                  <Tr key={key.id}>
                    <Td className="font-medium text-slate-800">{key.name}</Td>
                    <Td>
                      <code className="font-mono text-xs text-slate-600">{key.prefix}…</code>
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {key.scopes.length}
                    </Td>
                    <Td>
                      <Badge tone={key.active ? toneFor("active") : toneFor("revoked")}>
                        {key.active ? "Ativa" : "Revogada"}
                      </Badge>
                    </Td>
                    <Td className="text-slate-500">
                      {key.lastUsedAt ? formatDateTime(key.lastUsedAt) : "nunca usada"}
                    </Td>
                    <Td align="right">
                      {canWrite && key.active && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 size={14} />}
                          title="Revogar chave"
                          onClick={() => setRevoking(key)}
                        />
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={keys.data} onChange={setPage} label="chaves" />
          </>
        )}
      </Section>

      <FormDialog
        open={creating}
        title="Emitir chave de API"
        description="Escolha o menor conjunto de escopos que resolve a integracao."
        wide
        onClose={() => setCreating(false)}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          create.mutate();
        }}
        submitLabel="Emitir"
        submitting={create.isPending}
      >
        <Field label="Nome" error={fieldError(create.error, "name")}>
          <Input
            required
            autoFocus
            minLength={2}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Integracao com o ERP"
          />
        </Field>

        <Field
          label={`Escopos (${scopes.size} selecionados)`}
          error={fieldError(create.error, "scopes")}
          hint="Escopo que voce nao possui aparece travado."
        >
          <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
            {catalog.isPending ? (
              <Spinner />
            ) : (
              (catalog.data?.modules ?? []).map((group) => (
                <div key={group.module}>
                  <p className="sticky top-0 bg-slate-50 px-3 py-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                    {group.module}
                  </p>
                  {group.permissions.map((permission) => {
                    const grantable = can(permission.slug);
                    return (
                      <label
                        key={permission.slug}
                        className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
                          grantable
                            ? "cursor-pointer hover:bg-slate-50"
                            : "cursor-not-allowed opacity-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="size-3.5 accent-indigo-600"
                          disabled={!grantable}
                          checked={scopes.has(permission.slug)}
                          onChange={() => toggleScope(permission.slug)}
                        />
                        <code className="font-mono text-slate-700">{permission.slug}</code>
                        <span className="truncate text-slate-500">{permission.description}</span>
                      </label>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </Field>
      </FormDialog>

      <SecretDialog apiKey={issued} onClose={() => setIssued(null)} />

      <ConfirmDialog
        open={Boolean(revoking)}
        title="Revogar chave"
        destructive
        confirmLabel="Revogar"
        loading={revoke.isPending}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
        message={`A chave ${revoking?.name} para de funcionar imediatamente.`}
      />
    </>
  );
}

function SecretDialog({ apiKey, onClose }: { apiKey: CreatedApiKey | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!apiKey) return null;

  async function copy() {
    await navigator.clipboard.writeText(apiKey!.secret).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog
      open
      title="Chave emitida"
      description={apiKey.name}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Ja guardei
        </Button>
      }
    >
      <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Este segredo aparece uma unica vez. O banco guarda so o hash: fechando esta janela, nao ha
        como recupera-lo.
      </p>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
          {apiKey.secret}
        </code>
        <Button
          variant="secondary"
          onClick={copy}
          icon={copied ? <Check size={14} /> : <Copy size={14} />}
        >
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {apiKey.scopes.length} escopos · prefixo {apiKey.prefix}
      </p>
    </Dialog>
  );
}
