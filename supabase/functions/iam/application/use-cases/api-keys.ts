import {
  type AuditTrail,
  BaseUseCase,
  type Clock,
  type EventPublisher,
  type IdGenerator,
  NotFoundError,
  type Page,
  type PageRequest,
  type RequestContext,
  type SecretHasher,
} from "../../../_shared/mod.ts";
import { ApiKey } from "../../domain/entities.ts";
import type { ApiKeyRepository } from "../../domain/ports.ts";
import type { RoleAuthorizationPolicy } from "../../domain/services.ts";
import { ApiKeySecret } from "../../domain/value-objects.ts";
import { ApiKeyPresenter } from "../dto.ts";

export interface IssueApiKeyInput {
  name: string;
  scopes: string[];
  expiresInDays?: number;
}

/**
 * Emite uma chave de API. O escopo da chave nunca ultrapassa o do usuario que
 * a emitiu: e a mesma regra de nao escalonamento aplicada aos papeis.
 */
export class IssueApiKeyUseCase extends BaseUseCase<IssueApiKeyInput, Record<string, unknown>> {
  constructor(
    private readonly keys: ApiKeyRepository,
    private readonly policy: RoleAuthorizationPolicy,
    private readonly hasher: SecretHasher,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "iam.api_key.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: IssueApiKeyInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();

    await this.policy.ensurePermissionsExist(input.scopes);
    this.policy.ensureNoEscalation(input.scopes, ctx.permissions, ctx.role === "owner");

    const secret = ApiKeySecret.issue(this.hasher.generateSecret(32));
    const now = this.clock.now();

    const key = ApiKey.issue({
      id: this.ids.generate(),
      tenantId,
      name: input.name,
      secret,
      keyHash: await this.hasher.hash(secret.plaintext),
      scopes: input.scopes,
      createdBy: ctx.requireUserId(),
      expiresInDays: input.expiresInDays,
      now,
    });

    const saved = await this.keys.insert(key);
    await this.events.publish(key.pullEvents());
    await this.audit.record({
      action: "api_key.issued",
      resourceType: "api_key",
      resourceId: saved.id,
      metadata: { name: saved.name, prefix: saved.prefix, scopes: saved.scopes },
    });

    // Unica vez em que o segredo aparece.
    return { ...ApiKeyPresenter.toDto(saved, now), secret: secret.plaintext };
  }
}

export class ListApiKeysUseCase extends BaseUseCase<PageRequest, Record<string, unknown>> {
  constructor(
    private readonly keys: ApiKeyRepository,
    private readonly clock: Clock,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "iam.api_key.read";
  }

  protected override async handle(
    page: PageRequest,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const now = this.clock.now();
    const result: Page<unknown> = (await this.keys.list(ctx.requireTenantId(), page))
      .map((key) => ApiKeyPresenter.toDto(key, now));
    return result.toJSON();
  }
}

export class RevokeApiKeyUseCase extends BaseUseCase<{ id: string }, Record<string, unknown>> {
  constructor(
    private readonly keys: ApiKeyRepository,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "iam.api_key.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: { id: string },
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const now = this.clock.now();
    const key = await this.keys.findById(ctx.requireTenantId(), input.id);
    if (!key) throw new NotFoundError("Chave de API", input.id);

    key.revoke(now);
    const saved = await this.keys.update(key);

    await this.events.publish(key.pullEvents());
    await this.audit.record({
      action: "api_key.revoked",
      resourceType: "api_key",
      resourceId: saved.id,
      metadata: { prefix: saved.prefix },
    });
    return ApiKeyPresenter.toDto(saved, now);
  }
}
