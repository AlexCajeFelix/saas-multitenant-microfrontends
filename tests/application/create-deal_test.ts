/**
 * Prova pratica da arquitetura hexagonal: o caso de uso roda inteiro com
 * repositorios em memoria, sem Supabase, sem HTTP e sem banco.
 */
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { CreateDealUseCase } from "../../supabase/functions/crm/application/use-cases/deals.ts";
import { Deal } from "../../supabase/functions/crm/domain/entities.ts";
import type {
  CompanyRepository,
  ContactRepository,
  DealRepository,
  PipelineRepository,
  PipelineStageSummary,
} from "../../supabase/functions/crm/domain/ports.ts";
import { Pipeline, PipelineStage } from "../../supabase/functions/crm/domain/value-objects.ts";
import { Actor, RequestContext } from "../../supabase/functions/_shared/application/context.ts";
import { Page, PageRequest } from "../../supabase/functions/_shared/application/ports.ts";
import type { AuditEntry, AuditTrail } from "../../supabase/functions/_shared/application/ports.ts";
import type { DomainEvent } from "../../supabase/functions/_shared/domain/core.ts";
import {
  ForbiddenError,
  NotFoundError,
} from "../../supabase/functions/_shared/domain/errors.ts";

const TENANT = "8ac3d2f0-9a11-4d0e-9d7f-3f0c1a2b3c4d";
const USER = "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9";
const NOW = new Date("2026-06-01T10:00:00Z");

class InMemoryDealRepository implements DealRepository {
  readonly saved: Deal[] = [];

  getById(id: string): Promise<Deal> {
    const found = this.saved.find((deal) => deal.id === id);
    if (!found) return Promise.reject(new NotFoundError("Negocio", id));
    return Promise.resolve(found);
  }
  findById(id: string): Promise<Deal | null> {
    return Promise.resolve(this.saved.find((deal) => deal.id === id) ?? null);
  }
  search(): Promise<Page<Deal>> {
    return Promise.resolve(new Page(this.saved, this.saved.length, PageRequest.of()));
  }
  insert(deal: Deal): Promise<Deal> {
    this.saved.push(deal);
    return Promise.resolve(deal);
  }
  save(deal: Deal): Promise<Deal> {
    return Promise.resolve(deal);
  }
}

class InMemoryPipelineRepository implements PipelineRepository {
  load(): Promise<Pipeline> {
    return Promise.resolve(
      Pipeline.from([
        PipelineStage.create({ key: "lead", name: "Lead", position: 1, probability: 10 }),
        PipelineStage.create({ key: "proposal", name: "Proposta", position: 2, probability: 60 }),
        PipelineStage.create({
          key: "won",
          name: "Ganho",
          position: 3,
          probability: 100,
          isWon: true,
        }),
      ]),
    );
  }
  summary(): Promise<PipelineStageSummary[]> {
    return Promise.resolve([]);
  }
}

/** Repositorio que so conhece um id: qualquer outro e 404, como a RLS faria. */
class SingleRecordRepository {
  constructor(private readonly knownId: string) {}
  getById(id: string): Promise<never> {
    if (id === this.knownId) return Promise.resolve() as Promise<never>;
    return Promise.reject(new NotFoundError("Registro", id));
  }
}

class RecordingAudit implements AuditTrail {
  readonly entries: AuditEntry[] = [];
  record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

class RecordingEvents {
  readonly published: DomainEvent[] = [];
  publish(events: readonly DomainEvent[]): Promise<void> {
    this.published.push(...events);
    return Promise.resolve();
  }
}

function context(permissions: string[]): RequestContext {
  return new RequestContext({
    requestId: "test-request",
    actor: Actor.user(USER, "alice@acme.test"),
    tenantId: TENANT,
    tenantStatus: "active",
    isMember: true,
    role: "member",
    permissions,
    accessToken: "token",
    module: "crm",
  });
}

function build() {
  const deals = new InMemoryDealRepository();
  const audit = new RecordingAudit();
  const events = new RecordingEvents();
  const companies = new SingleRecordRepository("cccccccc-1111-4111-8111-111111111111");
  const contacts = new SingleRecordRepository("dddddddd-1111-4111-8111-111111111111");

  const useCase = new CreateDealUseCase(
    deals,
    new InMemoryPipelineRepository(),
    companies as unknown as CompanyRepository,
    contacts as unknown as ContactRepository,
    { generate: () => "eeeeeeee-1111-4111-8111-111111111111" },
    { now: () => NOW },
    events,
    audit,
  );

  return { useCase, deals, audit, events };
}

const INPUT = {
  title: "Contrato de manutencao",
  amountCents: 250000,
  currency: "BRL",
};

Deno.test("CreateDeal grava, publica o evento e registra a auditoria", async () => {
  const { useCase, deals, audit, events } = build();

  const dto = await useCase.execute(INPUT, context(["crm.deal.write"]));

  assertEquals(dto.title, "Contrato de manutencao");
  assertEquals(dto.stageKey, "lead");
  assertEquals(dto.amountCents, 250000);
  assertEquals(dto.weightedCents, 25000);
  assertEquals(deals.saved.length, 1);
  assertEquals(events.published.map((event) => event.name), ["crm.deal.created"]);
  assertEquals(audit.entries[0].action, "deal.created");
});

Deno.test("CreateDeal recusa quem nao tem a permissao", async () => {
  const { useCase, deals } = build();

  await assertRejects(
    () => useCase.execute(INPUT, context(["crm.deal.read"])),
    ForbiddenError,
  );
  assertEquals(deals.saved.length, 0);
});

Deno.test("CreateDeal recusa empresa de outro tenant", async () => {
  const { useCase } = build();

  await assertRejects(
    () =>
      useCase.execute(
        { ...INPUT, companyId: "ffffffff-1111-4111-8111-111111111111" },
        context(["crm.deal.write"]),
      ),
    NotFoundError,
  );
});

Deno.test("CreateDeal recusa escrita em tenant suspenso", async () => {
  const { useCase } = build();
  const suspended = new RequestContext({
    requestId: "test-request",
    actor: Actor.user(USER, "alice@acme.test"),
    tenantId: TENANT,
    tenantStatus: "suspended",
    isMember: true,
    role: "owner",
    permissions: ["crm.deal.write"],
    accessToken: "token",
    module: "crm",
  });

  await assertRejects(() => useCase.execute(INPUT, suspended), ForbiddenError);
});
