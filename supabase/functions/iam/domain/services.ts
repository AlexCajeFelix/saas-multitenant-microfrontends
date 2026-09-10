import { BusinessRuleError, ForbiddenError, ValidationError } from "../../_shared/mod.ts";
import type { PermissionCatalog, RoleRepository } from "./ports.ts";
import { PermissionSet } from "./value-objects.ts";

/**
 * Politica de autorizacao do proprio IAM.
 *
 * A regra central e a de nao escalonamento: ninguem concede a um papel uma
 * permissao que ele proprio nao possui. Sem ela, qualquer usuario com
 * iam.role.write poderia criar um papel com poder total e se atribuir a ele.
 */
export class RoleAuthorizationPolicy {
  constructor(
    private readonly catalog: PermissionCatalog,
    private readonly roles: RoleRepository,
  ) {}

  async ensurePermissionsExist(permissions: readonly string[]): Promise<void> {
    if (permissions.length === 0) return;
    const known = await this.catalog.existingSlugs(permissions);
    const unknown = permissions.filter((slug) => !known.includes(slug));
    if (unknown.length > 0) {
      throw new ValidationError("Permissoes desconhecidas", { unknown, known });
    }
  }

  /** O chamador so distribui o que ja tem. */
  ensureNoEscalation(
    requested: readonly string[],
    callerPermissions: readonly string[],
    isOwner: boolean,
  ): void {
    if (isOwner) return;
    const beyond = PermissionSet.of(requested).minus(PermissionSet.of(callerPermissions));
    if (beyond.length > 0) {
      throw new ForbiddenError(
        "Voce nao pode conceder permissoes que nao possui",
        { attempted: beyond },
      );
    }
  }

  /** Um papel ainda em uso nao pode ser apagado sem deixar membros orfaos. */
  async ensureUnused(tenantId: string, slug: string): Promise<void> {
    const inUse = await this.roles.countMembersUsing(tenantId, slug);
    if (inUse > 0) {
      throw new BusinessRuleError(
        `O papel ${slug} ainda esta atribuido a ${inUse} membro(s)`,
        { slug, members: inUse },
      );
    }
  }
}
