import { BusinessRuleError, type MembershipDirectory } from "../../_shared/mod.ts";
import type { TaskRepository } from "./ports.ts";

/**
 * Regras que atravessam agregados do modulo projects.
 */
export class WorkAssignmentPolicy {
  constructor(
    private readonly members: MembershipDirectory,
    private readonly tasks: TaskRepository,
  ) {}

  /**
   * Um responsavel precisa ser membro ativo do tenant. Sem isto seria possivel
   * atribuir trabalho a alguem de outra organizacao, que nunca veria a tarefa.
   */
  async ensureAssignable(tenantId: string, assigneeId: string | null): Promise<void> {
    if (!assigneeId) return;
    if (await this.members.isActiveMember(tenantId, assigneeId)) return;
    throw new BusinessRuleError("O responsavel precisa ser um membro ativo deste tenant", {
      assigneeId,
      tenantId,
    });
  }

  /** Quantas subtarefas ainda estao abertas. Entra na regra de conclusao. */
  async countOpenSubtasks(taskId: string): Promise<number> {
    return await this.tasks.countOpenSubtasks(taskId);
  }
}
