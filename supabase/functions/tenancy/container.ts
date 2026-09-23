import {
  type AuditTrail,
  type Clock,
  type EventPublisher,
  type IdGenerator,
  type Logger,
  type ModuleRuntime,
  OutboxEventPublisher,
  type RequestContext,
  type SecretHasher,
  SupabaseAuditTrail,
} from "../_shared/mod.ts";
import { MembershipPolicy } from "./domain/services.ts";
import type {
  InvitationRepository,
  MembershipRepository,
  RoleCatalog,
  TenantProvisioning,
  TenantRepository,
} from "./domain/ports.ts";
import {
  SupabaseInvitationRepository,
  SupabaseMembershipRepository,
  SupabaseTenantRepository,
} from "./infrastructure/persistence/repositories.ts";
import {
  SupabaseRoleCatalog,
  SupabaseTenantProvisioning,
} from "./infrastructure/persistence/cross-module.ts";
import {
  AcceptInvitationUseCase,
  InviteMemberUseCase,
  ListInvitationsUseCase,
  RevokeInvitationUseCase,
} from "./application/use-cases/invitations.ts";
import {
  ChangeMemberRoleUseCase,
  ListMembersUseCase,
  RemoveMemberUseCase,
} from "./application/use-cases/members.ts";
import {
  ChangeTenantStatusUseCase,
  CreateTenantUseCase,
  GetTenantUseCase,
  ListMyTenantsUseCase,
  UpdateTenantUseCase,
} from "./application/use-cases/tenant.ts";

/**
 * Raiz de composicao do modulo.
 *
 * Monta o grafo de dependencias de uma requisicao e e o unico lugar em que as
 * implementacoes concretas encontram as portas. Repositorios "admin" usam a
 * chave de servico e aparecem so onde a RLS nao teria como autorizar: criar um
 * tenant e aceitar um convite.
 */
export class TenancyContainer {
  private readonly cache = new Map<string, unknown>();

  private constructor(
    readonly ctx: RequestContext,
    private readonly runtime: ModuleRuntime,
  ) {}

  static create(ctx: RequestContext, runtime: ModuleRuntime): TenancyContainer {
    return new TenancyContainer(ctx, runtime);
  }

  private lazy<T>(key: string, factory: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, factory());
    return this.cache.get(key) as T;
  }

  // --- infraestrutura ------------------------------------------------------
  get logger(): Logger {
    return this.lazy(
      "logger",
      () =>
        this.runtime.logger.child({ requestId: this.ctx.requestId, tenantId: this.ctx.tenantId }),
    );
  }
  get clock(): Clock {
    return this.runtime.clock;
  }
  get ids(): IdGenerator {
    return this.runtime.ids;
  }
  get hasher(): SecretHasher {
    return this.runtime.hasher;
  }
  get events(): EventPublisher {
    return this.lazy(
      "events",
      () => new OutboxEventPublisher(this.runtime.connection.asService("core"), this.logger),
    );
  }
  get audit(): AuditTrail {
    return this.lazy(
      "audit",
      () =>
        new SupabaseAuditTrail(
          this.runtime.connection.asService("core"),
          this.ctx,
          this.logger,
        ),
    );
  }

  // --- repositorios --------------------------------------------------------
  /** Passa pela RLS com o JWT do usuario. O caminho normal. */
  get tenants(): TenantRepository {
    return this.lazy(
      "tenants",
      () => new SupabaseTenantRepository(this.runtime.connection.forActor(this.ctx, "core")),
    );
  }
  get memberships(): MembershipRepository {
    return this.lazy(
      "memberships",
      () => new SupabaseMembershipRepository(this.runtime.connection.forActor(this.ctx, "core")),
    );
  }
  get invitations(): InvitationRepository {
    return this.lazy(
      "invitations",
      () => new SupabaseInvitationRepository(this.runtime.connection.forActor(this.ctx, "core")),
    );
  }

  /** Fura a RLS. So para quem ainda nao tem vinculo com o tenant. */
  get adminTenants(): TenantRepository {
    return this.lazy(
      "adminTenants",
      () => new SupabaseTenantRepository(this.runtime.connection.asService("core")),
    );
  }
  get adminMemberships(): MembershipRepository {
    return this.lazy(
      "adminMemberships",
      () => new SupabaseMembershipRepository(this.runtime.connection.asService("core")),
    );
  }
  get adminInvitations(): InvitationRepository {
    return this.lazy(
      "adminInvitations",
      () => new SupabaseInvitationRepository(this.runtime.connection.asService("core")),
    );
  }

  // --- portas para outros modulos -----------------------------------------
  get roleCatalog(): RoleCatalog {
    return this.lazy(
      "roleCatalog",
      () => new SupabaseRoleCatalog(this.runtime.connection.asService("iam")),
    );
  }
  get provisioning(): TenantProvisioning {
    return this.lazy(
      "provisioning",
      () =>
        new SupabaseTenantProvisioning(
          this.runtime.connection.asService("crm"),
          this.runtime.connection.asService("billing"),
          this.logger,
        ),
    );
  }

  // --- servicos de dominio -------------------------------------------------
  get membershipPolicy(): MembershipPolicy {
    return this.lazy(
      "membershipPolicy",
      () => new MembershipPolicy(this.memberships, this.roleCatalog),
    );
  }

  // --- casos de uso --------------------------------------------------------
  get createTenant(): CreateTenantUseCase {
    return this.lazy(
      "createTenant",
      () =>
        new CreateTenantUseCase(
          this.adminTenants,
          this.adminMemberships,
          this.provisioning,
          this.ids,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get listMyTenants(): ListMyTenantsUseCase {
    return this.lazy("listMyTenants", () => new ListMyTenantsUseCase(this.memberships));
  }
  get getTenant(): GetTenantUseCase {
    return this.lazy("getTenant", () => new GetTenantUseCase(this.tenants));
  }
  get updateTenant(): UpdateTenantUseCase {
    return this.lazy(
      "updateTenant",
      () => new UpdateTenantUseCase(this.tenants, this.clock, this.audit),
    );
  }
  get suspendTenant(): ChangeTenantStatusUseCase {
    return this.lazy(
      "suspendTenant",
      () =>
        new ChangeTenantStatusUseCase(
          "suspended",
          this.tenants,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get activateTenant(): ChangeTenantStatusUseCase {
    return this.lazy(
      "activateTenant",
      () =>
        new ChangeTenantStatusUseCase("active", this.tenants, this.clock, this.events, this.audit),
    );
  }

  get listMembers(): ListMembersUseCase {
    return this.lazy("listMembers", () => new ListMembersUseCase(this.memberships));
  }
  get changeMemberRole(): ChangeMemberRoleUseCase {
    return this.lazy(
      "changeMemberRole",
      () =>
        new ChangeMemberRoleUseCase(
          this.memberships,
          this.membershipPolicy,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get removeMember(): RemoveMemberUseCase {
    return this.lazy(
      "removeMember",
      () =>
        new RemoveMemberUseCase(
          this.memberships,
          this.membershipPolicy,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }

  get inviteMember(): InviteMemberUseCase {
    return this.lazy(
      "inviteMember",
      () =>
        new InviteMemberUseCase(
          this.invitations,
          this.memberships,
          this.membershipPolicy,
          this.hasher,
          this.ids,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get listInvitations(): ListInvitationsUseCase {
    return this.lazy("listInvitations", () => new ListInvitationsUseCase(this.invitations));
  }
  get revokeInvitation(): RevokeInvitationUseCase {
    return this.lazy(
      "revokeInvitation",
      () => new RevokeInvitationUseCase(this.invitations, this.audit),
    );
  }
  get acceptInvitation(): AcceptInvitationUseCase {
    return this.lazy(
      "acceptInvitation",
      () =>
        new AcceptInvitationUseCase(
          this.adminInvitations,
          this.adminMemberships,
          this.hasher,
          this.ids,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
}
