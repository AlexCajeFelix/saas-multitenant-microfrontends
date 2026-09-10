import type { DomainEvent } from "../domain/core.ts";
import { InfrastructureError } from "../domain/errors.ts";
import type { RequestContext } from "../application/context.ts";
import type {
  AuditEntry,
  AuditTrail,
  Clock,
  EventPublisher,
  IdGenerator,
  Logger,
  MembershipDirectory,
  SecretHasher,
} from "../application/ports.ts";
import type { Db } from "./supabase.ts";

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = typeof LEVELS[number];

/** Log em uma linha JSON por evento, que e o que o docker logs entrega bem. */
export class ConsoleLogger implements Logger {
  private readonly threshold: number;

  constructor(
    private readonly bindings: Record<string, unknown> = {},
    level: string = Deno.env.get("LOG_LEVEL") ?? "info",
  ) {
    const index = LEVELS.indexOf(level as Level);
    this.threshold = index >= 0 ? index : 1;
  }

  private write(level: Level, message: string, context?: Record<string, unknown>): void {
    if (LEVELS.indexOf(level) < this.threshold) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      message,
      ...this.bindings,
      ...(context ?? {}),
    });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.write("debug", message, context);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.write("info", message, context);
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.write("warn", message, context);
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.write("error", message, context);
  }

  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger({ ...this.bindings, ...bindings }, LEVELS[this.threshold]);
  }
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Relogio fixo, para os testes de dominio. */
export class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}
  now(): Date {
    return new Date(this.instant.getTime());
  }
}

export class CryptoIdGenerator implements IdGenerator {
  generate(): string {
    return crypto.randomUUID();
  }
}

/**
 * Segredos de uso unico (tokens de convite, chaves de API): o valor em claro
 * so existe na resposta da criacao; o banco guarda apenas o SHA-256.
 */
export class Sha256SecretHasher implements SecretHasher {
  async hash(secret: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  generateSecret(bytes = 32): string {
    const buffer = new Uint8Array(bytes);
    crypto.getRandomValues(buffer);
    return Array.from(buffer)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
}

/**
 * Publica os eventos na tabela core.domain_events (padrao outbox). Um consumidor
 * externo pode ler dali e propagar, sem que o dominio saiba que isso existe.
 */
export class OutboxEventPublisher implements EventPublisher {
  constructor(
    private readonly coreClient: Db,
    private readonly logger: Logger,
  ) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    const rows = events.map((event) => ({
      id: event.eventId,
      tenant_id: event.tenantId,
      aggregate_type: event.aggregateType,
      aggregate_id: event.aggregateId,
      event_name: event.name,
      payload: event.payload(),
      occurred_at: event.occurredAt.toISOString(),
    }));

    const { error } = await this.coreClient.from("domain_events").insert(rows);
    if (error) {
      // Um evento perdido nao pode desfazer a operacao de negocio ja gravada.
      this.logger.error("falha ao gravar eventos de dominio", {
        error: error.message,
        events: rows.map((row) => row.event_name),
      });
    }
  }
}

/** Publisher para testes: guarda em memoria o que foi publicado. */
export class InMemoryEventPublisher implements EventPublisher {
  readonly published: DomainEvent[] = [];
  publish(events: readonly DomainEvent[]): Promise<void> {
    this.published.push(...events);
    return Promise.resolve();
  }
}

export class SupabaseAuditTrail implements AuditTrail {
  constructor(
    private readonly coreClient: Db,
    private readonly ctx: RequestContext,
    private readonly logger: Logger,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    const { error } = await this.coreClient.from("audit_logs").insert({
      tenant_id: this.ctx.tenantId,
      actor_id: this.ctx.actor.userId,
      module: this.ctx.module,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId ?? null,
      metadata: entry.metadata ?? {},
      request_id: this.ctx.requestId,
    });
    if (error) {
      this.logger.warn("falha ao gravar auditoria", { error: error.message, action: entry.action });
    }
  }
}

/**
 * Adaptador do diretorio de membros sobre core.memberships. Usa o cliente de
 * servico porque precisa responder sobre qualquer usuario do tenant, e nao
 * apenas sobre quem esta chamando.
 */
export class SupabaseMembershipDirectory implements MembershipDirectory {
  constructor(private readonly coreClient: Db) {}

  async isActiveMember(tenantId: string, userId: string): Promise<boolean> {
    return (await this.roleOf(tenantId, userId)) !== null;
  }

  async roleOf(tenantId: string, userId: string): Promise<string | null> {
    const { data, error } = await this.coreClient
      .from("memberships")
      .select("role_slug")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (error) {
      throw new InfrastructureError(`Falha ao consultar membros: ${error.message}`);
    }
    return data ? (data.role_slug as string) : null;
  }

  async countActiveMembers(tenantId: string): Promise<number> {
    const { count, error } = await this.coreClient
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "active");
    if (error) {
      throw new InfrastructureError(`Falha ao contar membros: ${error.message}`);
    }
    return count ?? 0;
  }
}
