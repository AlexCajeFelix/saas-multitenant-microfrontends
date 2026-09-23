import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Mail, Plus, Trash2 } from "lucide-react";
import { tenancyApi } from "@saas/platform/api/tenancy";
import { iamApi } from "@saas/platform/api/iam";
import type { CreatedInvitation, Invitation } from "@saas/platform/api/types";
import { useTenant } from "@saas/platform/lib/tenant";
import { useCan } from "@saas/platform/lib/permissions";
import { useApiMutation, fieldError } from "@saas/platform/lib/mutations";
import { formatDate, INVITATION_STATUS_LABEL, roleLabel } from "@saas/platform/lib/format";
import { PageHeader, Section } from "@saas/platform/components/PageHeader";
import { Badge, toneFor } from "@saas/platform/components/ui/Badge";
import { Button, PermissionButton } from "@saas/platform/components/ui/Button";
import { Field, Input, Select } from "@saas/platform/components/ui/Field";
import { ConfirmDialog, Dialog, FormDialog } from "@saas/platform/components/ui/Dialog";
import { Spinner, EmptyState, QueryError } from "@saas/platform/components/ui/States";
import { Table, Th, Td, Tr, Pagination } from "@saas/platform/components/ui/Table";

export function Invitations() {
  const { tenantId } = useTenant();
  const canWrite = useCan("tenancy.invitation.write");
  const [page, setPage] = useState(1);
  const [inviting, setInviting] = useState(false);
  const [issued, setIssued] = useState<CreatedInvitation | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [validForDays, setValidForDays] = useState(7);

  const invitations = useQuery({
    queryKey: ["invitations", tenantId, page],
    queryFn: () => tenancyApi.listInvitations({ page }),
  });

  const roles = useQuery({
    queryKey: ["roles", tenantId],
    queryFn: iamApi.listRoles,
    enabled: canWrite,
  });

  const invite = useApiMutation({
    mutationFn: () => tenancyApi.invite({ email: email.trim(), role, validForDays }),
    invalidate: [["invitations", tenantId]],
    onDone: (created) => {
      setInviting(false);
      setEmail("");
      // O token so existe nesta resposta; no banco fica apenas o hash SHA-256.
      setIssued(created);
    },
  });

  const revoke = useApiMutation({
    mutationFn: (id: string) => tenancyApi.revokeInvitation(id),
    invalidate: [["invitations", tenantId]],
    success: "Convite revogado",
    onDone: () => setRevoking(null),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    invite.mutate();
  }

  return (
    <>
      <PageHeader
        title="Convites"
        subtitle="Cada convite carrega um token de uso unico, guardado como hash. So o e-mail convidado consegue aceitar."
        actions={
          <PermissionButton
            permission="tenancy.invitation.write"
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => setInviting(true)}
          >
            Convidar
          </PermissionButton>
        }
      />

      <Section>
        {invitations.isPending ? (
          <Spinner />
        ) : invitations.isError ? (
          <QueryError error={invitations.error} />
        ) : invitations.data.items.length === 0 ? (
          <EmptyState
            icon={<Mail size={28} />}
            title="Nenhum convite ainda"
            message="Convide alguem por e-mail e entregue o token que aparece na resposta."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>E-mail</Th>
                  <Th>Papel</Th>
                  <Th>Situacao</Th>
                  <Th>Expira</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {invitations.data.items.map((invitation) => (
                  <Tr key={invitation.id}>
                    <Td className="font-medium text-slate-800">{invitation.email}</Td>
                    <Td>{roleLabel(invitation.role)}</Td>
                    <Td>
                      <Badge tone={toneFor(invitation.status)}>
                        {INVITATION_STATUS_LABEL[invitation.status]}
                      </Badge>
                    </Td>
                    <Td className="text-slate-500">{formatDate(invitation.expiresAt)}</Td>
                    <Td align="right">
                      {canWrite && invitation.status === "pending" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 size={14} />}
                          title="Revogar convite"
                          onClick={() => setRevoking(invitation)}
                        />
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={invitations.data} onChange={setPage} label="convites" />
          </>
        )}
      </Section>

      <FormDialog
        open={inviting}
        title="Convidar para o tenant"
        description="O convidado aceita em /convite, com a conta dele."
        onClose={() => setInviting(false)}
        onSubmit={submit}
        submitLabel="Gerar convite"
        submitting={invite.isPending}
      >
        <Field label="E-mail" error={fieldError(invite.error, "email")}>
          <Input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="pessoa@empresa.test"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Papel" error={fieldError(invite.error, "role")}>
            <Select value={role} onChange={(event) => setRole(event.target.value)}>
              {(roles.data ?? []).map((option) => (
                <option key={option.slug} value={option.slug}>
                  {roleLabel(option.slug)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Validade (dias)" error={fieldError(invite.error, "validForDays")}>
            <Input
              type="number"
              min={1}
              max={30}
              value={validForDays}
              onChange={(event) => setValidForDays(Number(event.target.value))}
            />
          </Field>
        </div>
      </FormDialog>

      <IssuedTokenDialog invitation={issued} onClose={() => setIssued(null)} />

      <ConfirmDialog
        open={Boolean(revoking)}
        title="Revogar convite"
        destructive
        confirmLabel="Revogar"
        loading={revoke.isPending}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
        message={`O token enviado para ${revoking?.email} deixa de valer.`}
      />
    </>
  );
}

/** O token so aparece aqui, uma vez. Depois disso resta o hash no banco. */
function IssuedTokenDialog({
  invitation,
  onClose,
}: {
  invitation: CreatedInvitation | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!invitation) return null;

  const link = `${window.location.origin}/convite?token=${invitation.token}`;

  async function copy() {
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog
      open
      title="Convite gerado"
      description={`Para ${invitation.email}, como ${roleLabel(invitation.role)}.`}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Entendi
        </Button>
      }
    >
      <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Este token aparece uma unica vez. O banco guarda so o hash, entao nao ha como recupera-lo
        depois: copie agora e entregue ao convidado.
      </p>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
          {link}
        </code>
        <Button
          variant="secondary"
          onClick={copy}
          icon={copied ? <Check size={14} /> : <Copy size={14} />}
        >
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">Expira em {formatDate(invitation.expiresAt)}.</p>
    </Dialog>
  );
}
