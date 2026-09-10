import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, UserMinus } from "lucide-react";
import { tenancyApi } from "../../api/tenancy";
import { iamApi } from "../../api/iam";
import type { Membership } from "../../api/types";
import { useTenant } from "../../lib/tenant";
import { useAuth } from "../../lib/auth";
import { useCan } from "../../lib/permissions";
import { useApiMutation } from "../../lib/mutations";
import { formatDate, roleLabel, shortId } from "../../lib/format";
import { PageHeader, Section } from "../../components/PageHeader";
import { Badge, toneFor } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Field";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { Spinner, EmptyState, QueryError } from "../../components/ui/States";
import { Table, Th, Td, Tr, Pagination } from "../../components/ui/Table";

export function Members() {
  const { tenantId } = useTenant();
  const { session } = useAuth();
  const canWrite = useCan("tenancy.member.write");
  const [page, setPage] = useState(1);
  const [removing, setRemoving] = useState<Membership | null>(null);

  const members = useQuery({
    queryKey: ["members", tenantId, page],
    queryFn: () => tenancyApi.listMembers({ page, sort: "created_at", order: "asc" }),
  });

  const roles = useQuery({
    queryKey: ["roles", tenantId],
    queryFn: iamApi.listRoles,
    enabled: canWrite,
  });

  const changeRole = useApiMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      tenancyApi.changeMemberRole(userId, role),
    invalidate: [["members", tenantId], ["whoami", tenantId]],
    success: "Papel atualizado",
  });

  const remove = useApiMutation({
    mutationFn: (userId: string) => tenancyApi.removeMember(userId),
    invalidate: [["members", tenantId]],
    success: "Membro removido do tenant",
    onDone: () => setRemoving(null),
  });

  return (
    <>
      <PageHeader
        title="Membros"
        subtitle="Quem participa deste tenant e com qual papel. O ultimo dono ativo nao pode ser rebaixado nem removido, e ninguem se remove sozinho."
      />

      <Section>
        {members.isPending ? (
          <Spinner />
        ) : members.isError ? (
          <QueryError error={members.error} />
        ) : members.data.items.length === 0 ? (
          <EmptyState icon={<Users size={28} />} title="Nenhum membro listado" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Usuario</Th>
                  <Th>Papel</Th>
                  <Th>Situacao</Th>
                  <Th>Entrou em</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {members.data.items.map((member) => {
                  const isMe = member.userId === session?.userId;
                  return (
                    <Tr key={member.id}>
                      <Td>
                        <span className="font-mono text-xs text-slate-600">
                          {shortId(member.userId)}
                        </span>
                        {isMe && (
                          <Badge tone="brand" className="ml-2">
                            voce
                          </Badge>
                        )}
                      </Td>
                      <Td>
                        {canWrite && member.status === "active" ? (
                          <Select
                            value={member.role}
                            disabled={changeRole.isPending}
                            onChange={(event) =>
                              changeRole.mutate({
                                userId: member.userId,
                                role: event.target.value,
                              })
                            }
                            className="h-8 w-40 py-0 text-xs"
                          >
                            {(roles.data ?? []).map((role) => (
                              <option key={role.slug} value={role.slug}>
                                {roleLabel(role.slug)}
                              </option>
                            ))}
                            {!roles.data?.some((role) => role.slug === member.role) && (
                              <option value={member.role}>{roleLabel(member.role)}</option>
                            )}
                          </Select>
                        ) : (
                          <Badge tone="neutral">{roleLabel(member.role)}</Badge>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={toneFor(member.status)}>
                          {member.status === "active" ? "Ativo" : "Revogado"}
                        </Badge>
                      </Td>
                      <Td className="text-slate-500">{formatDate(member.createdAt)}</Td>
                      <Td align="right">
                        {canWrite && member.status === "active" && !isMe && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<UserMinus size={14} />}
                            onClick={() => setRemoving(member)}
                            title="Remover do tenant"
                          />
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={members.data} onChange={setPage} label="membros" />
          </>
        )}
      </Section>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remover membro"
        destructive
        confirmLabel="Remover"
        loading={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.userId)}
        message={
          <>
            O vinculo de <span className="font-mono">{shortId(removing?.userId)}</span> passa a
            revogado. Ele perde o acesso aos dados deste tenant imediatamente, pela propria RLS.
          </>
        }
      />
    </>
  );
}
