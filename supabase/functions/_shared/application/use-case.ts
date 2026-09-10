import type { RequestContext } from "./context.ts";

/**
 * Porta de entrada. Toda operacao de negocio do sistema e um objeto desta
 * forma; os controllers HTTP nao fazem nada alem de traduzir e delegar.
 */
export interface UseCase<TInput, TOutput> {
  execute(input: TInput, ctx: RequestContext): Promise<TOutput>;
}

/**
 * Base que centraliza a checagem de autorizacao. A subclasse declara de que
 * permissao precisa e se exige tenant ativo; a regra de negocio fica limpa.
 */
export abstract class BaseUseCase<TInput, TOutput> implements UseCase<TInput, TOutput> {
  /** Permissao exigida. Nulo significa que basta estar autenticado. */
  protected abstract get permission(): string | null;

  /** Operacoes de escrita marcam true e passam a recusar tenant suspenso. */
  protected get mutating(): boolean {
    return false;
  }

  async execute(input: TInput, ctx: RequestContext): Promise<TOutput> {
    if (this.permission) {
      ctx.requirePermission(this.permission);
    }
    if (this.mutating) {
      ctx.requireActiveTenant();
    }
    return await this.handle(input, ctx);
  }

  protected abstract handle(input: TInput, ctx: RequestContext): Promise<TOutput>;
}
