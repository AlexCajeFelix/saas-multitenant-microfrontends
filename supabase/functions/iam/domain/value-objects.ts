import { Guard, ValidationError, ValueObject } from "../../_shared/mod.ts";

/** Slug de papel: minusculas, numeros, hifen e sublinhado. */
export class RoleSlug extends ValueObject<{ value: string }> {
  private static readonly PATTERN = /^[a-z][a-z0-9_-]{1,30}$/;
  private static readonly SYSTEM = ["owner", "admin", "manager", "member", "viewer"];

  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): RoleSlug {
    const normalized = Guard.notBlank(raw, "slug").toLowerCase();
    Guard.matches(normalized, RoleSlug.PATTERN, "slug", "minusculas, numeros, hifen, sublinhado");
    return new RoleSlug(normalized);
  }

  get value(): string {
    return this.props.value;
  }
  get isSystemName(): boolean {
    return RoleSlug.SYSTEM.includes(this.props.value);
  }
  override toString(): string {
    return this.props.value;
  }
}

/** Permissao no formato modulo.recurso.acao. */
export class PermissionSlug extends ValueObject<{ value: string }> {
  private static readonly PATTERN = /^[a-z]+\.[a-z_]+\.[a-z_]+$/;

  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): PermissionSlug {
    const normalized = Guard.notBlank(raw, "permission").toLowerCase();
    Guard.matches(normalized, PermissionSlug.PATTERN, "permission", "modulo.recurso.acao");
    return new PermissionSlug(normalized);
  }

  get value(): string {
    return this.props.value;
  }
  get module(): string {
    return this.props.value.split(".")[0];
  }
  get action(): string {
    return this.props.value.split(".")[2];
  }
  get isWrite(): boolean {
    return this.action !== "read";
  }
  override toString(): string {
    return this.props.value;
  }
}

/**
 * Conjunto de permissoes de um papel. Imutavel: cada operacao devolve um novo
 * conjunto, o que torna o diff entre antes e depois trivial de auditar.
 */
export class PermissionSet extends ValueObject<{ values: string[] }> {
  private constructor(values: string[]) {
    super({ values: [...new Set(values)].sort() });
  }

  static empty(): PermissionSet {
    return new PermissionSet([]);
  }

  static of(slugs: readonly string[]): PermissionSet {
    return new PermissionSet(slugs.map((slug) => PermissionSlug.create(slug).value));
  }

  get values(): string[] {
    return [...this.props.values];
  }
  get size(): number {
    return this.props.values.length;
  }

  has(slug: string): boolean {
    return this.props.values.includes(slug.toLowerCase());
  }

  with(slugs: readonly string[]): PermissionSet {
    return PermissionSet.of([...this.props.values, ...slugs]);
  }

  without(slugs: readonly string[]): PermissionSet {
    const removing = new Set(slugs.map((slug) => slug.toLowerCase()));
    return new PermissionSet(this.props.values.filter((value) => !removing.has(value)));
  }

  /** O que este conjunto tem e o outro nao. Usado na regra de escalonamento. */
  minus(other: PermissionSet): string[] {
    return this.props.values.filter((value) => !other.has(value));
  }
}

/**
 * Segredo de uma chave de API. Nasce como `prefixo_segredo`; o prefixo fica
 * legivel no banco para o usuario reconhecer a chave, o resto vira hash.
 */
export class ApiKeySecret extends ValueObject<{ prefix: string; secret: string }> {
  private constructor(prefix: string, secret: string) {
    super({ prefix, secret });
  }

  static issue(secret: string): ApiKeySecret {
    if (!/^[0-9a-f]{32,128}$/.test(secret)) {
      throw new ValidationError("Segredo de chave de API invalido");
    }
    return new ApiKeySecret(`sk_${secret.slice(0, 8)}`, secret);
  }

  get prefix(): string {
    return this.props.prefix;
  }

  /** O valor completo, entregue uma unica vez na resposta da emissao. */
  get plaintext(): string {
    return `${this.props.prefix}_${this.props.secret}`;
  }
}
