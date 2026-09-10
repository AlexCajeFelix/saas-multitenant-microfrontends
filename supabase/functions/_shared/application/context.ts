import { ForbiddenError, UnauthorizedError } from "../domain/errors.ts";

export type ActorKind = "user" | "service" | "anonymous";

/** Quem esta chamando. */
export class Actor {
  private constructor(
    readonly kind: ActorKind,
    readonly userId: string | null,
    readonly email: string | null,
  ) {}

  static user(userId: string, email: string | null): Actor {
    return new Actor("user", userId, email);
  }
  static service(): Actor {
    return new Actor("service", null, null);
  }
  static anonymous(): Actor {
    return new Actor("anonymous", null, null);
  }

  get isService(): boolean {
    return this.kind === "service";
  }
  get isAuthenticated(): boolean {
    return this.kind !== "anonymous";
  }

  toJSON(): Record<string, unknown> {
    return { kind: this.kind, userId: this.userId, email: this.email };
  }
}

export interface RequestContextProps {
  requestId: string;
  actor: Actor;
  tenantId: string | null;
  tenantStatus: string | null;
  isMember: boolean;
  role: string | null;
  permissions: readonly string[];
  accessToken: string | null;
  module: string;
}

/**
 * O contexto de uma requisicao: identidade, tenant corrente e permissoes
 * efetivas, resolvidos uma unica vez na borda e repassados a todos os casos
 * de uso. Nenhuma camada abaixo consulta headers ou JWT.
 */
export class RequestContext {
  readonly requestId: string;
  readonly actor: Actor;
  readonly tenantId: string | null;
  readonly tenantStatus: string | null;
  readonly isMember: boolean;
  readonly role: string | null;
  readonly accessToken: string | null;
  readonly module: string;
  readonly startedAt: Date;
  private readonly permissionSet: ReadonlySet<string>;

  constructor(props: RequestContextProps) {
    this.requestId = props.requestId;
    this.actor = props.actor;
    this.tenantId = props.tenantId;
    this.tenantStatus = props.tenantStatus;
    this.isMember = props.isMember;
    this.role = props.role;
    this.accessToken = props.accessToken;
    this.module = props.module;
    this.permissionSet = new Set(props.permissions);
    this.startedAt = new Date();
  }

  get permissions(): string[] {
    return [...this.permissionSet].sort();
  }

  requireUserId(): string {
    if (!this.actor.userId) {
      throw new UnauthorizedError("Esta operacao exige um usuario autenticado");
    }
    return this.actor.userId;
  }

  requireTenantId(): string {
    if (!this.tenantId) {
      throw new ForbiddenError("Informe o tenant no header x-tenant-id");
    }
    return this.tenantId;
  }

  can(permission: string): boolean {
    if (this.actor.isService) return true;
    return this.permissionSet.has(permission);
  }

  requirePermission(...permissions: string[]): void {
    if (this.actor.isService) return;
    if (!this.actor.isAuthenticated) {
      throw new UnauthorizedError("Autenticacao necessaria");
    }
    this.requireTenantId();
    if (!this.isMember) {
      throw new ForbiddenError("Voce nao e membro deste tenant", { tenantId: this.tenantId });
    }
    const missing = permissions.filter((p) => !this.permissionSet.has(p));
    if (missing.length > 0) {
      throw new ForbiddenError("Permissao insuficiente", {
        required: permissions,
        missing,
        role: this.role,
      });
    }
  }

  /** Recusa escrita em tenant suspenso; leitura continua liberada. */
  requireActiveTenant(): void {
    if (this.actor.isService) return;
    if (this.tenantStatus && this.tenantStatus !== "active") {
      throw new ForbiddenError(`Tenant ${this.tenantStatus}: operacao de escrita bloqueada`, {
        tenantId: this.tenantId,
        status: this.tenantStatus,
      });
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      requestId: this.requestId,
      module: this.module,
      actor: this.actor.toJSON(),
      tenantId: this.tenantId,
      role: this.role,
      isMember: this.isMember,
    };
  }
}
