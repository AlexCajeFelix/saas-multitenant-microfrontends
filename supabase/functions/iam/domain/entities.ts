import { AggregateRoot, BusinessRuleError, Guard } from "../../_shared/mod.ts";
import { ApiKeyIssued, ApiKeyRevoked, RoleCreated, RolePermissionsChanged } from "./events.ts";
import { ApiKeySecret, PermissionSet, RoleSlug } from "./value-objects.ts";

interface RoleProps extends Record<string, unknown> {
  tenantId: string | null;
  slug: RoleSlug;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: PermissionSet;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Papel: um nome para um conjunto de permissoes.
 *
 * Papeis de sistema tem tenantId nulo, sao compartilhados por todos os tenants
 * e nao podem ser alterados. Papeis do tenant sao criados e mantidos aqui.
 */
export class Role extends AggregateRoot<RoleProps> {
  private constructor(id: string, props: RoleProps) {
    super(id, props);
  }

  static create(input: {
    id: string;
    tenantId: string;
    slug: string;
    name: string;
    description?: string;
    permissions: readonly string[];
    now: Date;
  }): Role {
    const role = new Role(input.id, {
      tenantId: input.tenantId,
      slug: RoleSlug.create(input.slug),
      name: Guard.length(input.name, "name", 2, 80),
      description: (input.description ?? "").slice(0, 240),
      isSystem: false,
      permissions: PermissionSet.of(input.permissions),
      createdAt: input.now,
      updatedAt: input.now,
    });
    role.record(new RoleCreated(input.tenantId, input.id, role.slug));
    return role;
  }

  static restore(id: string, props: RoleProps): Role {
    return new Role(id, props);
  }

  /** Papel global nao pertence a tenant algum; devolve string vazia. */
  override get tenantId(): string {
    return this.props.tenantId ?? "";
  }

  get scopeTenantId(): string | null {
    return this.props.tenantId;
  }
  get slug(): string {
    return this.props.slug.value;
  }
  get name(): string {
    return this.props.name;
  }
  get description(): string {
    return this.props.description;
  }
  get isSystem(): boolean {
    return this.props.isSystem;
  }
  get isGlobal(): boolean {
    return this.props.tenantId === null;
  }
  get permissions(): PermissionSet {
    return this.props.permissions;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  private assertEditable(): void {
    if (this.props.isSystem || this.isGlobal) {
      throw new BusinessRuleError("Papeis de sistema nao podem ser alterados", {
        slug: this.slug,
      });
    }
  }

  rename(name: string, description: string | undefined, now: Date): void {
    this.assertEditable();
    this.props.name = Guard.length(name, "name", 2, 80);
    if (description !== undefined) this.props.description = description.slice(0, 240);
    this.props.updatedAt = now;
  }

  /** Substitui o conjunto inteiro e registra o diff no evento. */
  replacePermissions(permissions: readonly string[], now: Date): void {
    this.assertEditable();
    const next = PermissionSet.of(permissions);
    const granted = next.minus(this.props.permissions);
    const revoked = this.props.permissions.minus(next);
    if (granted.length === 0 && revoked.length === 0) return;

    this.props.permissions = next;
    this.props.updatedAt = now;
    this.record(new RolePermissionsChanged(this.tenantId, this._id, granted, revoked));
  }

  grant(permissions: readonly string[], now: Date): void {
    this.replacePermissions(this.props.permissions.with(permissions).values, now);
  }

  revoke(permissions: readonly string[], now: Date): void {
    this.replacePermissions(this.props.permissions.without(permissions).values, now);
  }

  ensureDeletable(): void {
    this.assertEditable();
  }
}

interface ApiKeyProps extends Record<string, unknown> {
  tenantId: string;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: string[];
  createdBy: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Chave de API do tenant. O segredo em claro so existe na resposta da emissao;
 * o que fica gravado e o prefixo, para reconhecimento, e o hash.
 */
export class ApiKey extends AggregateRoot<ApiKeyProps> {
  private constructor(id: string, props: ApiKeyProps) {
    super(id, props);
  }

  static issue(input: {
    id: string;
    tenantId: string;
    name: string;
    secret: ApiKeySecret;
    keyHash: string;
    scopes: readonly string[];
    createdBy: string;
    expiresInDays?: number;
    now: Date;
  }): ApiKey {
    const expiresAt = input.expiresInDays
      ? new Date(input.now.getTime() + Guard.range(input.expiresInDays, "expiresInDays", 1, 3650) * 86_400_000)
      : null;

    const key = new ApiKey(input.id, {
      tenantId: input.tenantId,
      name: Guard.length(input.name, "name", 2, 80),
      prefix: input.secret.prefix,
      keyHash: input.keyHash,
      scopes: PermissionSet.of(input.scopes).values,
      createdBy: input.createdBy,
      lastUsedAt: null,
      expiresAt,
      revokedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
    key.record(new ApiKeyIssued(input.tenantId, input.id, key.prefix, key.name));
    return key;
  }

  static restore(id: string, props: ApiKeyProps): ApiKey {
    return new ApiKey(id, props);
  }

  override get tenantId(): string {
    return this.props.tenantId;
  }
  get name(): string {
    return this.props.name;
  }
  get prefix(): string {
    return this.props.prefix;
  }
  get keyHash(): string {
    return this.props.keyHash;
  }
  get scopes(): string[] {
    return [...this.props.scopes];
  }
  get createdBy(): string | null {
    return this.props.createdBy;
  }
  get lastUsedAt(): Date | null {
    return this.props.lastUsedAt;
  }
  get expiresAt(): Date | null {
    return this.props.expiresAt;
  }
  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  isActiveAt(moment: Date): boolean {
    if (this.props.revokedAt) return false;
    if (this.props.expiresAt && this.props.expiresAt.getTime() <= moment.getTime()) return false;
    return true;
  }

  revoke(now: Date): void {
    if (this.props.revokedAt) {
      throw new BusinessRuleError("Esta chave ja foi revogada", { prefix: this.prefix });
    }
    this.props.revokedAt = now;
    this.props.updatedAt = now;
    this.record(new ApiKeyRevoked(this.tenantId, this._id, this.prefix));
  }

  markUsed(now: Date): void {
    this.props.lastUsedAt = now;
    this.props.updatedAt = now;
  }
}
