import {
  BaseUseCase,
  ConflictError,
  ForbiddenError,
  type AuditTrail,
  type Clock,
  type EventPublisher,
  type IdGenerator,
  type RequestContext,
  Slug,
} from "../../../_shared/mod.ts";
import { Membership, Tenant } from "../../domain/entities.ts";
import type {
  MembershipRepository,
  TenantProvisioning,
  TenantRepository,
} from "../../domain/ports.ts";
import { TenantPresenter } from "../dto.ts";

export interface CreateTenantInput {
  name: string;
  slug?: string;
  settings?: Record<string, unknown>;
}

/**
 * Cria um tenant e ja instala tudo que ele precisa para funcionar: o vinculo
 * do dono, o funil padrao do CRM e a assinatura inicial.
 *
 * E a unica operacao de escrita do sistema que roda com a chave de servico,
 * porque no instante em que ela comeca ainda nao existe vinculo nenhum entre o
 * usuario e o tenant, logo nao ha como a RLS autorizar.
 */
export class CreateTenantUseCase extends BaseUseCase<CreateTenantInput, Record<string, unknown>> {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly memberships: MembershipRepository,
    private readonly provisioning: TenantProvisioning,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return null; // basta estar autenticado: qualquer usuario pode abrir um tenant
  }

  protected override async handle(
    input: CreateTenantInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const ownerId = ctx.requireUserId();
    const now = this.clock.now();
    const slug = input.slug ? Slug.create(input.slug) : Slug.fromName(input.name);

    if (await this.tenants.findBySlug(slug.value)) {
      throw new ConflictError("Ja existe um tenant com este identificador", {
        slug: slug.value,
      });
    }

    const tenant = Tenant.create({
      id: this.ids.generate(),
      name: input.name,
      slug: slug.value,
      ownerId,
      settings: input.settings,
      now,
    });
    const saved = await this.tenants.insert(tenant);

    await this.memberships.insert(
      Membership.create({
        id: this.ids.generate(),
        tenantId: saved.id,
        userId: ownerId,
        role: "owner",
        now,
      }),
    );

    await this.provisioning.installDefaults(saved.id, ownerId);
    await this.events.publish(tenant.pullEvents());
    await this.audit.record({
      action: "tenant.created",
      resourceType: "tenant",
      resourceId: saved.id,
      metadata: { slug: saved.slug },
    });

    return TenantPresenter.toDto(saved);
  }
}

/** Lista os tenants em que o usuario e membro ativo. Nao exige x-tenant-id. */
export class ListMyTenantsUseCase extends BaseUseCase<void, Record<string, unknown>[]> {
  constructor(private readonly memberships: MembershipRepository) {
    super();
  }

  protected override get permission(): string | null {
    return null;
  }

  protected override async handle(
    _input: void,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>[]> {
    const views = await this.memberships.listTenantsOf(ctx.requireUserId());
    return views.map((view) => TenantPresenter.toMembershipDto(view));
  }
}

/** Garante que o recurso pedido na URL e o mesmo do header x-tenant-id. */
function assertSameTenant(id: string, ctx: RequestContext): string {
  const current = ctx.requireTenantId();
  if (id !== current) {
    throw new ForbiddenError("O tenant da URL nao e o do header x-tenant-id", {
      requested: id,
      current,
    });
  }
  return current;
}

export class GetTenantUseCase extends BaseUseCase<{ id: string }, Record<string, unknown>> {
  constructor(private readonly tenants: TenantRepository) {
    super();
  }

  protected override get permission(): string | null {
    return "tenancy.tenant.read";
  }

  protected override async handle(
    input: { id: string },
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    return TenantPresenter.toDto(await this.tenants.getById(assertSameTenant(input.id, ctx)));
  }
}

export interface UpdateTenantInput {
  id: string;
  name?: string;
  settings?: Record<string, unknown>;
}

export class UpdateTenantUseCase extends BaseUseCase<UpdateTenantInput, Record<string, unknown>> {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly clock: Clock,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "tenancy.tenant.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: UpdateTenantInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenant = await this.tenants.getById(assertSameTenant(input.id, ctx));
    const now = this.clock.now();

    if (input.name !== undefined) tenant.rename(input.name, now);
    if (input.settings !== undefined) tenant.mergeSettings(input.settings, now);

    const saved = await this.tenants.update(tenant);
    await this.audit.record({
      action: "tenant.updated",
      resourceType: "tenant",
      resourceId: saved.id,
      metadata: { fields: Object.keys(input).filter((key) => key !== "id") },
    });
    return TenantPresenter.toDto(saved);
  }
}

export interface ChangeTenantStatusInput {
  id: string;
  reason?: string;
}

/**
 * Suspende ou reativa o tenant. Nao herda a checagem de tenant ativo, porque
 * reativar so faz sentido justamente quando ele nao esta ativo.
 */
export class ChangeTenantStatusUseCase
  extends BaseUseCase<ChangeTenantStatusInput, Record<string, unknown>> {
  constructor(
    private readonly target: "suspended" | "active" | "cancelled",
    private readonly tenants: TenantRepository,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "tenancy.tenant.write";
  }

  protected override async handle(
    input: ChangeTenantStatusInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenant = await this.tenants.getById(assertSameTenant(input.id, ctx));
    const now = this.clock.now();
    const reason = input.reason ?? null;

    if (this.target === "suspended") tenant.suspend(reason, now);
    else if (this.target === "active") tenant.activate(now);
    else tenant.cancel(reason, now);

    const saved = await this.tenants.update(tenant);
    await this.events.publish(tenant.pullEvents());
    await this.audit.record({
      action: `tenant.${this.target}`,
      resourceType: "tenant",
      resourceId: saved.id,
      metadata: { reason },
    });
    return TenantPresenter.toDto(saved);
  }
}
