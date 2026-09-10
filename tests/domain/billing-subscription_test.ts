import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { Invoice, Plan, Subscription } from "../../supabase/functions/billing/domain/entities.ts";
import { PlanCode, PlanLimits } from "../../supabase/functions/billing/domain/value-objects.ts";
import { PlanLimitPolicy } from "../../supabase/functions/billing/domain/services.ts";
import type { TenantUsageReader } from "../../supabase/functions/billing/domain/ports.ts";
import { DateRange, Money } from "../../supabase/functions/_shared/domain/value-objects.ts";
import { BusinessRuleError } from "../../supabase/functions/_shared/domain/errors.ts";

const NOW = new Date("2026-01-01T00:00:00Z");
const MID = new Date("2026-01-16T00:00:00Z");
const TENANT = "8ac3d2f0-9a11-4d0e-9d7f-3f0c1a2b3c4d";
const USER = "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9";

function plan(code: string, priceCents: number, limits: Record<string, number | null>): Plan {
  return Plan.restore(`plan-${code}`, {
    code: PlanCode.create(code),
    name: code.toUpperCase(),
    description: "",
    price: Money.fromCents(priceCents),
    interval: "month",
    trialDays: 0,
    features: [],
    limits: PlanLimits.fromJson(limits),
    isActive: true,
    position: 1,
  });
}

const FREE = plan("free", 0, { users: 3, projects: 2, deals: 50, contacts: 200 });
const PRO = plan("pro", 29900, { users: 50, projects: 200, deals: 5000, contacts: 50000 });

function newSubscription(from: Plan = FREE): Subscription {
  return Subscription.start({
    id: "aaaa1111-2222-4333-8444-555555555555",
    tenantId: TENANT,
    plan: from,
    createdBy: USER,
    now: NOW,
  });
}

Deno.test("Subscription comeca ativa quando o plano nao tem teste gratuito", () => {
  const subscription = newSubscription();
  assertEquals(subscription.status.value, "active");
  assertEquals(subscription.planCode, "free");
  assertEquals(subscription.pullEvents()[0].name, "billing.subscription.started");
});

Deno.test("changePlan rateia pela fracao restante do periodo", () => {
  const subscription = newSubscription();
  subscription.pullEvents();

  const proration = subscription.changePlan(PRO, MID);

  // Periodo de 31 dias, 16 ainda por consumir: nada a creditar do free e
  // 16/31 do preco do pro a cobrar.
  assertEquals(proration.remainingRatio, 0.5161);
  assertEquals(proration.credit.cents, 0);
  assertEquals(proration.charge.cents, 15432);
  assertEquals(proration.difference.cents, 15432);
  assertEquals(subscription.planCode, "pro");
  assertEquals(subscription.pullEvents()[0].name, "billing.subscription.plan_changed");
});

Deno.test("changePlan credita o que sobrou do plano mais caro", () => {
  const subscription = newSubscription(PRO);
  const proration = subscription.changePlan(FREE, MID);

  assertEquals(proration.credit.cents, 15432);
  assertEquals(proration.charge.cents, 0);
  assertEquals(proration.difference.cents, -15432, "credito a favor do tenant");
});

Deno.test("Subscription recusa trocar para o mesmo plano e operar apos cancelada", () => {
  const subscription = newSubscription();
  assertThrows(() => subscription.changePlan(FREE, MID), BusinessRuleError, "ja esta neste plano");

  subscription.cancel(false, MID);
  assertEquals(subscription.status.value, "cancelled");
  assertThrows(() => subscription.changePlan(PRO, MID), BusinessRuleError);
  assertThrows(() => subscription.cancel(false, MID), BusinessRuleError);
  assertThrows(() => subscription.ensureInvoiceable(), BusinessRuleError);
});

Deno.test("PlanLimits aponta cada recurso estourado", () => {
  const violations = FREE.limits.violationsFor({
    users: 5,
    projects: 4,
    deals: 10,
    contacts: 10,
  });
  assertEquals(violations, [
    { resource: "users", limit: 3, current: 5 },
    { resource: "projects", limit: 2, current: 4 },
  ]);
  assertEquals(PRO.limits.violationsFor({ users: 5, projects: 4, deals: 10, contacts: 10 }), []);
});

Deno.test("PlanLimitPolicy bloqueia a descida de plano que nao comporta o uso", async () => {
  const reader: TenantUsageReader = {
    snapshot: () => Promise.resolve({ users: 8, projects: 12, deals: 90, contacts: 300 }),
  };
  const policy = new PlanLimitPolicy(reader);

  const check = await policy.check(TENANT, PRO);
  assertEquals(check.withinLimits, true);

  await policy.ensureFits(TENANT, PRO);
  try {
    await policy.ensureFits(TENANT, FREE);
    throw new Error("deveria ter recusado");
  } catch (error) {
    if (!(error instanceof BusinessRuleError)) throw error;
    assertEquals((error.details.violations as unknown[]).length, 4);
  }
});

Deno.test("Invoice deriva os totais das linhas e trava depois de paga", () => {
  const invoice = Invoice.draft({
    id: "bbbb1111-2222-4333-8444-555555555555",
    tenantId: TENANT,
    subscriptionId: null,
    number: "2026-000001",
    currency: "BRL",
    period: DateRange.monthFrom(NOW),
    createdBy: USER,
    now: NOW,
  });

  invoice.addLine({ id: "l1", description: "Assinatura Pro", quantity: 1, unitAmountCents: 29900 });
  invoice.addLine({ id: "l2", description: "Usuarios extras", quantity: 3, unitAmountCents: 1000 });
  invoice.applyTax(1500);

  assertEquals(invoice.subtotal.cents, 32900);
  assertEquals(invoice.total.cents, 34400);

  invoice.issue(15, NOW);
  assertEquals(invoice.status.value, "open");
  assertThrows(() => invoice.addLine({ id: "l3", description: "x", quantity: 1, unitAmountCents: 1 }));

  invoice.markPaid(MID);
  assertEquals(invoice.status.value, "paid");
  assertThrows(() => invoice.markPaid(MID), BusinessRuleError);
  assertThrows(() => invoice.cancelInvoice(MID), BusinessRuleError);
});

Deno.test("Invoice nao e emitida sem linhas", () => {
  const invoice = Invoice.draft({
    id: "bbbb1111-2222-4333-8444-555555555555",
    tenantId: TENANT,
    subscriptionId: null,
    number: "2026-000002",
    currency: "BRL",
    period: DateRange.monthFrom(NOW),
    createdBy: USER,
    now: NOW,
  });
  assertThrows(() => invoice.issue(15, NOW), BusinessRuleError, "sem nenhuma linha");
});
