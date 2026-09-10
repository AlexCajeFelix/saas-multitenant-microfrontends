import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { Deal } from "../../supabase/functions/crm/domain/entities.ts";
import { Pipeline, PipelineStage } from "../../supabase/functions/crm/domain/value-objects.ts";
import { BusinessRuleError, ValidationError } from "../../supabase/functions/_shared/domain/errors.ts";

const NOW = new Date("2026-03-10T12:00:00Z");
const TENANT = "8ac3d2f0-9a11-4d0e-9d7f-3f0c1a2b3c4d";
const USER = "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9";

function pipeline(): Pipeline {
  return Pipeline.from([
    PipelineStage.create({ key: "lead", name: "Lead", position: 1, probability: 10 }),
    PipelineStage.create({ key: "proposal", name: "Proposta", position: 2, probability: 60 }),
    PipelineStage.create({ key: "won", name: "Ganho", position: 3, probability: 100, isWon: true }),
    PipelineStage.create({ key: "lost", name: "Perdido", position: 4, probability: 0, isLost: true }),
  ]);
}

function newDeal(): Deal {
  return Deal.create({
    id: "3f9a1c22-1111-4222-8333-444455556666",
    tenantId: TENANT,
    title: "Contrato anual",
    pipeline: pipeline(),
    amountCents: 500000,
    createdBy: USER,
    now: NOW,
  });
}

Deno.test("Deal nasce no primeiro estagio e emite o evento de criacao", () => {
  const deal = newDeal();
  assertEquals(deal.stageKey, "lead");
  assertEquals(deal.probability, 10);
  assertEquals(deal.status.value, "open");

  const events = deal.pullEvents();
  assertEquals(events.length, 1);
  assertEquals(events[0].name, "crm.deal.created");
  assertEquals(deal.pullEvents().length, 0, "a fila esvazia depois de consumida");
});

Deno.test("Deal adota a probabilidade do estagio de destino", () => {
  const deal = newDeal();
  deal.pullEvents();
  deal.moveTo("proposal", pipeline(), NOW);

  assertEquals(deal.stageKey, "proposal");
  assertEquals(deal.probability, 60);
  assertEquals(deal.weightedAmount.cents, 300000);
  assertEquals(deal.pullEvents()[0].name, "crm.deal.stage_changed");
});

Deno.test("Deal recusa mover direto para um estagio de fechamento", () => {
  const deal = newDeal();
  assertThrows(() => deal.moveTo("won", pipeline(), NOW), BusinessRuleError, "fechamento");
});

Deno.test("Deal recusa estagio inexistente", () => {
  const deal = newDeal();
  assertThrows(() => deal.moveTo("inventado", pipeline(), NOW), ValidationError);
});

Deno.test("Deal ganho e terminal", () => {
  const deal = newDeal();
  deal.win(pipeline(), NOW);

  assertEquals(deal.status.value, "won");
  assertEquals(deal.stageKey, "won");
  assertEquals(deal.probability, 100);
  assertEquals(deal.closedAt?.toISOString(), NOW.toISOString());

  assertThrows(() => deal.moveTo("lead", pipeline(), NOW), BusinessRuleError);
  assertThrows(() => deal.win(pipeline(), NOW), BusinessRuleError);
  assertThrows(() => deal.update({ title: "Outro" }, NOW), BusinessRuleError);
});

Deno.test("Deal perdido guarda o motivo", () => {
  const deal = newDeal();
  deal.lose("Preco acima do orcamento", pipeline(), NOW);

  assertEquals(deal.status.value, "lost");
  assertEquals(deal.lostReason, "Preco acima do orcamento");
  assertEquals(deal.probability, 0);
});

Deno.test("Deal acumula atividades para o repositorio gravar", () => {
  const deal = newDeal();
  deal.pullEvents();
  deal.logActivity({
    id: "aaaaaaa1-1111-4111-8111-111111111111",
    kind: "call",
    subject: "Ligacao de prospeccao",
    createdBy: USER,
    now: NOW,
  });

  assertEquals(deal.activities.length, 1);
  assertEquals(deal.pullNewActivities().length, 1);
  assertEquals(deal.pullNewActivities().length, 0);
  assertEquals(deal.pullEvents()[0].name, "crm.activity.logged");
});

Deno.test("Deal recusa data de fechamento no passado", () => {
  assertThrows(
    () =>
      Deal.create({
        id: "3f9a1c22-1111-4222-8333-444455556666",
        tenantId: TENANT,
        title: "Contrato anual",
        pipeline: pipeline(),
        expectedCloseDate: new Date("2020-01-01T00:00:00Z"),
        createdBy: USER,
        now: NOW,
      }),
    BusinessRuleError,
  );
});
