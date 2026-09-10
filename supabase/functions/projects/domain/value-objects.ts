import { BusinessRuleError, Guard, ValueObject } from "../../_shared/mod.ts";

export type ProjectStatusValue = "planning" | "active" | "on_hold" | "completed" | "archived";
export const PROJECT_STATUSES: readonly ProjectStatusValue[] = [
  "planning",
  "active",
  "on_hold",
  "completed",
  "archived",
];

/** Situacao do projeto, com as transicoes validas. Arquivado e terminal. */
export class ProjectStatus extends ValueObject<{ value: ProjectStatusValue }> {
  private static readonly TRANSITIONS: Record<ProjectStatusValue, ProjectStatusValue[]> = {
    planning: ["active", "archived"],
    active: ["on_hold", "completed", "archived"],
    on_hold: ["active", "archived"],
    completed: ["active", "archived"],
    archived: [],
  };

  private constructor(value: ProjectStatusValue) {
    super({ value });
  }

  static create(raw: string): ProjectStatus {
    return new ProjectStatus(Guard.oneOf(raw, PROJECT_STATUSES, "status"));
  }
  static planning(): ProjectStatus {
    return new ProjectStatus("planning");
  }

  get value(): ProjectStatusValue {
    return this.props.value;
  }
  get isArchived(): boolean {
    return this.props.value === "archived";
  }
  get acceptsWork(): boolean {
    return this.props.value !== "archived" && this.props.value !== "completed";
  }

  transitionTo(next: ProjectStatusValue): ProjectStatus {
    const allowed = ProjectStatus.TRANSITIONS[this.props.value];
    if (!allowed.includes(next)) {
      throw new BusinessRuleError(`Nao e possivel ir de ${this.props.value} para ${next}`, {
        from: this.props.value,
        to: next,
        allowed,
      });
    }
    return new ProjectStatus(next);
  }
}

export type TaskStatusValue = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
export const TASK_STATUSES: readonly TaskStatusValue[] = [
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
];

export class TaskStatus extends ValueObject<{ value: TaskStatusValue }> {
  private static readonly TRANSITIONS: Record<TaskStatusValue, TaskStatusValue[]> = {
    todo: ["in_progress", "blocked", "done", "cancelled"],
    in_progress: ["todo", "blocked", "done", "cancelled"],
    blocked: ["todo", "in_progress", "cancelled"],
    done: ["todo", "in_progress"],
    cancelled: ["todo"],
  };

  private constructor(value: TaskStatusValue) {
    super({ value });
  }

  static create(raw: string): TaskStatus {
    return new TaskStatus(Guard.oneOf(raw, TASK_STATUSES, "status"));
  }
  static todo(): TaskStatus {
    return new TaskStatus("todo");
  }

  get value(): TaskStatusValue {
    return this.props.value;
  }
  get isDone(): boolean {
    return this.props.value === "done";
  }
  get isOpen(): boolean {
    return this.props.value !== "done" && this.props.value !== "cancelled";
  }

  transitionTo(next: TaskStatusValue): TaskStatus {
    if (next === this.props.value) return this;
    const allowed = TaskStatus.TRANSITIONS[this.props.value];
    if (!allowed.includes(next)) {
      throw new BusinessRuleError(`Tarefa nao vai de ${this.props.value} para ${next}`, {
        from: this.props.value,
        to: next,
        allowed,
      });
    }
    return new TaskStatus(next);
  }
}

export type TaskPriorityValue = "low" | "medium" | "high" | "urgent";
export const TASK_PRIORITIES: readonly TaskPriorityValue[] = ["low", "medium", "high", "urgent"];

export class TaskPriority extends ValueObject<{ value: TaskPriorityValue }> {
  private constructor(value: TaskPriorityValue) {
    super({ value });
  }
  static create(raw: string): TaskPriority {
    return new TaskPriority(Guard.oneOf(raw, TASK_PRIORITIES, "priority"));
  }
  static medium(): TaskPriority {
    return new TaskPriority("medium");
  }
  get value(): TaskPriorityValue {
    return this.props.value;
  }
  get weight(): number {
    return TASK_PRIORITIES.indexOf(this.props.value);
  }
}

/** Codigo curto do projeto, em maiusculas. Unico dentro do tenant. */
export class ProjectCode extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): ProjectCode {
    const normalized = Guard.notBlank(raw, "code").toUpperCase();
    Guard.matches(normalized, /^[A-Z][A-Z0-9-]{1,15}$/, "code", "maiusculas, numeros e hifen");
    return new ProjectCode(normalized);
  }

  /** Deriva um codigo do nome quando o cliente nao informa nenhum. */
  static fromName(name: string): ProjectCode {
    const letters = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const base = letters.slice(0, 6) || "PROJ";
    return ProjectCode.create(base);
  }

  get value(): string {
    return this.props.value;
  }
  override toString(): string {
    return this.props.value;
  }
}

/** Duracao em minutos, com a leitura em horas que os relatorios usam. */
export class Duration extends ValueObject<{ minutes: number }> {
  private constructor(minutes: number) {
    super({ minutes });
  }

  static ofMinutes(minutes: number, field = "minutes"): Duration {
    Guard.integer(minutes, field);
    Guard.range(minutes, field, 1, 1440);
    return new Duration(minutes);
  }

  static zero(): Duration {
    return new Duration(0);
  }

  get minutes(): number {
    return this.props.minutes;
  }
  get hours(): number {
    return Math.round((this.props.minutes / 60) * 100) / 100;
  }
  plus(other: Duration): Duration {
    return new Duration(this.props.minutes + other.minutes);
  }
}
