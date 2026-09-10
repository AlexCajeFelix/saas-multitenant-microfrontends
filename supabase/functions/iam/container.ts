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
import type {
  ApiKeyRepository,
  MembershipAssignments,
  PermissionCatalog,
  RoleRepository,
} from "./domain/ports.ts";
import { RoleAuthorizationPolicy } from "./domain/services.ts";
import {
  SupabaseApiKeyRepository,
  SupabaseMembershipAssignments,
  SupabasePermissionCatalog,
  SupabaseRoleRepository,
} from "./infrastructure/persistence/repositories.ts";
import {
  IssueApiKeyUseCase,
  ListApiKeysUseCase,
  RevokeApiKeyUseCase,
} from "./application/use-cases/api-keys.ts";
import {
  AssignRoleUseCase,
  ChangeRolePermissionsUseCase,
  CreateRoleUseCase,
  DeleteRoleUseCase,
  ListPermissionsUseCase,
  ListRolesUseCase,
  UpdateRoleUseCase,
  WhoAmIUseCase,
} from "./application/use-cases/roles.ts";

/** Raiz de composicao do modulo iam. */
export class IamContainer {
  private readonly cache = new Map<string, unknown>();

  private constructor(
    readonly ctx: RequestContext,
    private readonly runtime: ModuleRuntime,
  ) {}

  static create(ctx: RequestContext, runtime: ModuleRuntime): IamContainer {
    return new IamContainer(ctx, runtime);
  }

  private lazy<T>(key: string, factory: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, factory());
    return this.cache.get(key) as T;
  }

  get logger(): Logger {
    return this.lazy("logger", () =>
      this.runtime.logger.child({ requestId: this.ctx.requestId, tenantId: this.ctx.tenantId }));
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
        new SupabaseAuditTrail(this.runtime.connection.asService("core"), this.ctx, this.logger),
    );
  }

  get roles(): RoleRepository {
    return this.lazy(
      "roles",
      () =>
        new SupabaseRoleRepository(
          this.runtime.connection.forActor(this.ctx, "iam"),
          this.runtime.connection.asService("iam"),
        ),
    );
  }
  get apiKeys(): ApiKeyRepository {
    return this.lazy(
      "apiKeys",
      () =>
        new SupabaseApiKeyRepository(
          this.runtime.connection.forActor(this.ctx, "iam"),
          this.ctx.tenantId ?? "",
        ),
    );
  }
  get permissionCatalog(): PermissionCatalog {
    return this.lazy(
      "permissionCatalog",
      () => new SupabasePermissionCatalog(this.runtime.connection.forActor(this.ctx, "iam")),
    );
  }
  get assignments(): MembershipAssignments {
    return this.lazy(
      "assignments",
      () =>
        new SupabaseMembershipAssignments(this.runtime.connection.forActor(this.ctx, "core")),
    );
  }

  get authorizationPolicy(): RoleAuthorizationPolicy {
    return this.lazy(
      "authorizationPolicy",
      () => new RoleAuthorizationPolicy(this.permissionCatalog, this.roles),
    );
  }

  get listPermissions(): ListPermissionsUseCase {
    return this.lazy("listPermissions", () => new ListPermissionsUseCase(this.permissionCatalog));
  }
  get whoAmI(): WhoAmIUseCase {
    return this.lazy("whoAmI", () => new WhoAmIUseCase());
  }
  get listRoles(): ListRolesUseCase {
    return this.lazy("listRoles", () => new ListRolesUseCase(this.roles));
  }
  get createRole(): CreateRoleUseCase {
    return this.lazy(
      "createRole",
      () =>
        new CreateRoleUseCase(
          this.roles,
          this.authorizationPolicy,
          this.ids,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get updateRole(): UpdateRoleUseCase {
    return this.lazy(
      "updateRole",
      () =>
        new UpdateRoleUseCase(
          this.roles,
          this.authorizationPolicy,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get deleteRole(): DeleteRoleUseCase {
    return this.lazy(
      "deleteRole",
      () => new DeleteRoleUseCase(this.roles, this.authorizationPolicy, this.audit),
    );
  }
  get grantPermissions(): ChangeRolePermissionsUseCase {
    return this.lazy(
      "grantPermissions",
      () =>
        new ChangeRolePermissionsUseCase(
          "grant",
          this.roles,
          this.authorizationPolicy,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get revokePermissions(): ChangeRolePermissionsUseCase {
    return this.lazy(
      "revokePermissions",
      () =>
        new ChangeRolePermissionsUseCase(
          "revoke",
          this.roles,
          this.authorizationPolicy,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get assignRole(): AssignRoleUseCase {
    return this.lazy(
      "assignRole",
      () => new AssignRoleUseCase(this.roles, this.assignments, this.events, this.audit),
    );
  }

  get issueApiKey(): IssueApiKeyUseCase {
    return this.lazy(
      "issueApiKey",
      () =>
        new IssueApiKeyUseCase(
          this.apiKeys,
          this.authorizationPolicy,
          this.hasher,
          this.ids,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get listApiKeys(): ListApiKeysUseCase {
    return this.lazy("listApiKeys", () => new ListApiKeysUseCase(this.apiKeys, this.clock));
  }
  get revokeApiKey(): RevokeApiKeyUseCase {
    return this.lazy(
      "revokeApiKey",
      () => new RevokeApiKeyUseCase(this.apiKeys, this.clock, this.events, this.audit),
    );
  }
}
