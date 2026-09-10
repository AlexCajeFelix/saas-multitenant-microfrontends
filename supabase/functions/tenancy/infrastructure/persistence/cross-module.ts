import { type Db, InfrastructureError, type Logger } from "../../../_shared/mod.ts";
import type { RoleCatalog, TenantProvisioning } from "../../domain/ports.ts";

/**
 * Adaptador de anticorrupcao sobre iam.roles. O modulo tenancy nunca importa o
 * dominio de iam: ele so pergunta, por esta porta, se um papel existe.
 */
export class SupabaseRoleCatalog implements RoleCatalog {
  constructor(private readonly iamClient: Db) {}

  async exists(tenantId: string, roleSlug: string): Promise<boolean> {
    const { data, error } = await this.iamClient
      .from("roles")
      .select("id")
      .ilike("slug", roleSlug)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .limit(1);
    if (error) throw new InfrastructureError(`Falha ao consultar papeis: ${error.message}`);
    return (data ?? []).length > 0;
  }

  async listAvailable(tenantId: string): Promise<string[]> {
    const { data, error } = await this.iamClient
      .from("roles")
      .select("slug")
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order("slug");
    if (error) throw new InfrastructureError(`Falha ao listar papeis: ${error.message}`);
    return [...new Set(((data ?? []) as { slug: string }[]).map((row) => row.slug))];
  }
}

/**
 * Provisionamento de um tenant novo: funil padrao no CRM e assinatura inicial
 * no plano gratuito. Sao escritas em outros modulos, feitas com a chave de
 * servico e isoladas atras desta porta, para que o caso de uso de criacao nao
 * saiba nada sobre pipeline nem sobre planos.
 */
export class SupabaseTenantProvisioning implements TenantProvisioning {
  constructor(
    private readonly crmClient: Db,
    private readonly billingClient: Db,
    private readonly logger: Logger,
  ) {}

  async installDefaults(tenantId: string, ownerId: string): Promise<void> {
    const { error: pipelineError } = await this.crmClient.rpc("install_default_pipeline", {
      p_tenant: tenantId,
    });
    if (pipelineError) {
      throw new InfrastructureError(
        `Falha ao instalar o funil padrao: ${pipelineError.message}`,
      );
    }

    const { data: plan, error: planError } = await this.billingClient
      .from("plans")
      .select("id, trial_days")
      .eq("code", "free")
      .maybeSingle();
    if (planError) {
      throw new InfrastructureError(`Falha ao localizar o plano inicial: ${planError.message}`);
    }
    if (!plan) {
      this.logger.warn("plano free ausente; tenant criado sem assinatura", { tenantId });
      return;
    }

    const start = new Date();
    const end = new Date(start.getTime());
    end.setUTCMonth(end.getUTCMonth() + 1);

    const { error: subscriptionError } = await this.billingClient.from("subscriptions").insert({
      tenant_id: tenantId,
      plan_id: plan.id,
      status: "active",
      current_period_start: start.toISOString(),
      current_period_end: end.toISOString(),
      created_by: ownerId,
    });
    if (subscriptionError) {
      throw new InfrastructureError(
        `Falha ao criar a assinatura inicial: ${subscriptionError.message}`,
      );
    }
  }
}
