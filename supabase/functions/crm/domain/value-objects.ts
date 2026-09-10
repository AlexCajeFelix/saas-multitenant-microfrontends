import {
  BusinessRuleError,
  Guard,
  ValidationError,
  ValueObject,
} from "../../_shared/mod.ts";

export type DealStatusValue = "open" | "won" | "lost";

/** Situacao do negocio. Ganho e perdido sao terminais. */
export class DealStatus extends ValueObject<{ value: DealStatusValue }> {
  private constructor(value: DealStatusValue) {
    super({ value });
  }

  static create(raw: string): DealStatus {
    return new DealStatus(Guard.oneOf(raw, ["open", "won", "lost"] as const, "status"));
  }
  static open(): DealStatus {
    return new DealStatus("open");
  }
  static won(): DealStatus {
    return new DealStatus("won");
  }
  static lost(): DealStatus {
    return new DealStatus("lost");
  }

  get value(): DealStatusValue {
    return this.props.value;
  }
  get isOpen(): boolean {
    return this.props.value === "open";
  }
  get isClosed(): boolean {
    return !this.isOpen;
  }
}

export type ActivityKindValue = "call" | "email" | "meeting" | "note" | "task";
export const ACTIVITY_KINDS: readonly ActivityKindValue[] = [
  "call",
  "email",
  "meeting",
  "note",
  "task",
];

export class ActivityKind extends ValueObject<{ value: ActivityKindValue }> {
  private constructor(value: ActivityKindValue) {
    super({ value });
  }
  static create(raw: string): ActivityKind {
    return new ActivityKind(Guard.oneOf(raw, ACTIVITY_KINDS, "kind"));
  }
  get value(): ActivityKindValue {
    return this.props.value;
  }
}

/** Um estagio do funil, como o tenant o configurou. */
export class PipelineStage extends ValueObject<{
  key: string;
  name: string;
  position: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}> {
  private constructor(props: {
    key: string;
    name: string;
    position: number;
    probability: number;
    isWon: boolean;
    isLost: boolean;
  }) {
    super(props);
  }

  static create(input: {
    key: string;
    name: string;
    position: number;
    probability: number;
    isWon?: boolean;
    isLost?: boolean;
  }): PipelineStage {
    return new PipelineStage({
      key: Guard.matches(
        input.key.toLowerCase(),
        /^[a-z][a-z0-9_]{1,30}$/,
        "stage",
        "minusculas, numeros e sublinhado",
      ),
      name: Guard.length(input.name, "name", 2, 60),
      position: Guard.integer(input.position, "position"),
      probability: Guard.range(input.probability, "probability", 0, 100),
      isWon: input.isWon ?? false,
      isLost: input.isLost ?? false,
    });
  }

  get key(): string {
    return this.props.key;
  }
  get name(): string {
    return this.props.name;
  }
  get position(): number {
    return this.props.position;
  }
  get probability(): number {
    return this.props.probability;
  }
  get isWon(): boolean {
    return this.props.isWon;
  }
  get isLost(): boolean {
    return this.props.isLost;
  }
  get isTerminal(): boolean {
    return this.props.isWon || this.props.isLost;
  }
}

/**
 * O funil do tenant. Sabe quais estagios existem e quais movimentos sao
 * validos; e o objeto que o agregado Deal consulta antes de se mover.
 */
export class Pipeline {
  private constructor(private readonly stages: readonly PipelineStage[]) {}

  static from(stages: readonly PipelineStage[]): Pipeline {
    if (stages.length === 0) {
      throw new BusinessRuleError("O funil deste tenant nao tem estagios configurados");
    }
    return new Pipeline([...stages].sort((a, b) => a.position - b.position));
  }

  get all(): readonly PipelineStage[] {
    return this.stages;
  }
  get keys(): string[] {
    return this.stages.map((stage) => stage.key);
  }
  get first(): PipelineStage {
    return this.stages[0];
  }

  find(key: string): PipelineStage | undefined {
    return this.stages.find((stage) => stage.key === key.toLowerCase());
  }

  require(key: string): PipelineStage {
    const stage = this.find(key);
    if (!stage) {
      throw new ValidationError(`Estagio desconhecido: ${key}`, { available: this.keys });
    }
    return stage;
  }

  /** Estagio que marca ganho, usado ao fechar o negocio. */
  get wonStage(): PipelineStage | undefined {
    return this.stages.find((stage) => stage.isWon);
  }
  get lostStage(): PipelineStage | undefined {
    return this.stages.find((stage) => stage.isLost);
  }

  /**
   * Mover para um estagio terminal so acontece por win() ou lose(), que
   * registram data de fechamento e motivo. Bloquear aqui evita um negocio
   * "ganho" sem nenhuma das duas coisas.
   */
  ensureMovable(target: PipelineStage): void {
    if (target.isTerminal) {
      throw new BusinessRuleError(
        `O estagio ${target.key} e de fechamento: use as rotas de ganho ou perda`,
        { stage: target.key },
      );
    }
  }
}

/** Nome de contato, com a composicao do nome completo. */
export class PersonName extends ValueObject<{ first: string; last: string }> {
  private constructor(first: string, last: string) {
    super({ first, last });
  }

  static create(first: string, last = ""): PersonName {
    return new PersonName(
      Guard.length(first, "firstName", 1, 80),
      (last ?? "").trim().slice(0, 80),
    );
  }

  get first(): string {
    return this.props.first;
  }
  get last(): string {
    return this.props.last;
  }
  get full(): string {
    return this.props.last ? `${this.props.first} ${this.props.last}` : this.props.first;
  }
}
