import {
  BusinessRuleError,
  Guard,
  ValidationError,
  ValueObject,
} from "../../_shared/mod.ts";

export type TenantStatusValue = "active" | "suspended" | "cancelled";
const TENANT_STATUSES: readonly TenantStatusValue[] = ["active", "suspended", "cancelled"];

/**
 * Situacao do tenant, com as transicoes permitidas embutidas. Cancelado e
 * terminal: quem cancela nao volta atras por esta porta.
 */
export class TenantStatus extends ValueObject<{ value: TenantStatusValue }> {
  private static readonly TRANSITIONS: Record<TenantStatusValue, TenantStatusValue[]> = {
    active: ["suspended", "cancelled"],
    suspended: ["active", "cancelled"],
    cancelled: [],
  };

  private constructor(value: TenantStatusValue) {
    super({ value });
  }

  static create(raw: string): TenantStatus {
    return new TenantStatus(Guard.oneOf(raw, TENANT_STATUSES, "status"));
  }

  static active(): TenantStatus {
    return new TenantStatus("active");
  }

  get value(): TenantStatusValue {
    return this.props.value;
  }
  get isActive(): boolean {
    return this.props.value === "active";
  }

  transitionTo(next: TenantStatusValue): TenantStatus {
    const allowed = TenantStatus.TRANSITIONS[this.props.value];
    if (!allowed.includes(next)) {
      throw new BusinessRuleError(`Nao e possivel ir de ${this.props.value} para ${next}`, {
        from: this.props.value,
        to: next,
        allowed,
      });
    }
    return new TenantStatus(next);
  }

  override toString(): string {
    return this.props.value;
  }
}

export type MembershipStatusValue = "active" | "revoked";

export class MembershipStatus extends ValueObject<{ value: MembershipStatusValue }> {
  private constructor(value: MembershipStatusValue) {
    super({ value });
  }
  static create(raw: string): MembershipStatus {
    return new MembershipStatus(Guard.oneOf(raw, ["active", "revoked"] as const, "status"));
  }
  static active(): MembershipStatus {
    return new MembershipStatus("active");
  }
  get value(): MembershipStatusValue {
    return this.props.value;
  }
  get isActive(): boolean {
    return this.props.value === "active";
  }
}

/**
 * Papel de um membro. O catalogo de papeis vive no modulo iam; aqui so
 * garantimos o formato e reconhecemos quem e dono.
 */
export class MemberRole extends ValueObject<{ value: string }> {
  static readonly OWNER = "owner";
  private static readonly PATTERN = /^[a-z][a-z0-9_-]{1,30}$/;

  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): MemberRole {
    const normalized = Guard.notBlank(raw, "role").toLowerCase();
    Guard.matches(
      normalized,
      MemberRole.PATTERN,
      "role",
      "minusculas, numeros, hifen e sublinhado",
    );
    return new MemberRole(normalized);
  }

  static owner(): MemberRole {
    return new MemberRole(MemberRole.OWNER);
  }

  get value(): string {
    return this.props.value;
  }
  get isOwner(): boolean {
    return this.props.value === MemberRole.OWNER;
  }
  override toString(): string {
    return this.props.value;
  }
}

export type InvitationStatusValue = "pending" | "accepted" | "revoked" | "expired";

export class InvitationStatus extends ValueObject<{ value: InvitationStatusValue }> {
  private constructor(value: InvitationStatusValue) {
    super({ value });
  }
  static create(raw: string): InvitationStatus {
    return new InvitationStatus(
      Guard.oneOf(raw, ["pending", "accepted", "revoked", "expired"] as const, "status"),
    );
  }
  static pending(): InvitationStatus {
    return new InvitationStatus("pending");
  }
  static of(value: InvitationStatusValue): InvitationStatus {
    return new InvitationStatus(value);
  }
  get value(): InvitationStatusValue {
    return this.props.value;
  }
  get isPending(): boolean {
    return this.props.value === "pending";
  }
}

/**
 * Token de convite. O valor em claro so existe no momento da emissao, para
 * seguir no e-mail; o agregado guarda apenas o hash.
 */
export class InvitationToken extends ValueObject<{ hash: string }> {
  private constructor(hash: string) {
    super({ hash });
  }

  static fromHash(hash: string): InvitationToken {
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw new ValidationError("Hash de convite invalido");
    }
    return new InvitationToken(hash);
  }

  get hash(): string {
    return this.props.hash;
  }
}
