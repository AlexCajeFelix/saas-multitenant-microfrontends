import { BusinessRuleError } from "../../_shared/mod.ts";
import type { Membership } from "./entities.ts";
import type { MembershipRepository, RoleCatalog } from "./ports.ts";

/**
 * Regras que envolvem mais de um Membership e por isso nao cabem dentro de um
 * unico agregado. Um servico de dominio: sem estado, sem infraestrutura.
 */
export class MembershipPolicy {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly roles: RoleCatalog,
  ) {}

  /** Um tenant sem nenhum dono ativo ficaria sem quem o administre. */
  async ensureNotLastOwner(membership: Membership, operation: string): Promise<void> {
    if (!membership.isOwner || !membership.isActive) return;
    const owners = await this.memberships.countActiveOwners(membership.tenantId);
    if (owners <= 1) {
      throw new BusinessRuleError(
        `Nao e possivel ${operation}: este e o unico dono ativo do tenant`,
        { tenantId: membership.tenantId, owners },
      );
    }
  }

  /** O papel precisa existir, seja de sistema ou criado pelo proprio tenant. */
  async ensureRoleExists(tenantId: string, roleSlug: string): Promise<void> {
    if (await this.roles.exists(tenantId, roleSlug)) return;
    const available = await this.roles.listAvailable(tenantId);
    throw new BusinessRuleError(`Papel desconhecido: ${roleSlug}`, { roleSlug, available });
  }

  /** Ninguem se remove nem se rebaixa sozinho: evita perder o proprio acesso. */
  ensureNotSelf(membership: Membership, actorUserId: string, operation: string): void {
    if (membership.userId === actorUserId) {
      throw new BusinessRuleError(`Voce nao pode ${operation} a si mesmo`, {
        userId: actorUserId,
      });
    }
  }
}
