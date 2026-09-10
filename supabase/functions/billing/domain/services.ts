import { BusinessRuleError } from "../../_shared/mod.ts";
import type { Plan } from "./entities.ts";
import type { TenantUsageReader } from "./ports.ts";
import type { LimitViolation, UsageSnapshot } from "./value-objects.ts";

export interface LimitCheck {
  plan: string;
  usage: UsageSnapshot;
  limits: Record<string, number | null>;
  violations: LimitViolation[];
  withinLimits: boolean;
}

/**
 * Politica de limites do plano.
 *
 * Serve a dois momentos: recusar a descida para um plano que nao comporta o
 * que o tenant ja usa, e responder quanto do plano corrente ja foi consumido.
 */
export class PlanLimitPolicy {
  constructor(private readonly usage: TenantUsageReader) {}

  async check(tenantId: string, plan: Plan): Promise<LimitCheck> {
    const snapshot = await this.usage.snapshot(tenantId);
    const violations = plan.limits.violationsFor(snapshot);
    return {
      plan: plan.code,
      usage: snapshot,
      limits: plan.limits.toJSON(),
      violations,
      withinLimits: violations.length === 0,
    };
  }

  /** Trocar para um plano menor so vale se o consumo atual couber nele. */
  async ensureFits(tenantId: string, plan: Plan): Promise<LimitCheck> {
    const result = await this.check(tenantId, plan);
    if (!result.withinLimits) {
      throw new BusinessRuleError(
        `O consumo atual excede os limites do plano ${plan.code}`,
        { violations: result.violations, plan: plan.code },
      );
    }
    return result;
  }
}
