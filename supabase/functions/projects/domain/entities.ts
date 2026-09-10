import {
  AggregateRoot,
  BusinessRuleError,
  Entity,
  Guard,
  Money,
} from "../../_shared/mod.ts";
import {
  ProjectCreated,
  ProjectStatusChanged,
  TaskAssigned,
  TaskCreated,
  TaskStatusChanged,
  TimeLogged,
} from "./events.ts";
import {
  Duration,
  ProjectCode,
  ProjectStatus,
  type ProjectStatusValue,
  TaskPriority,
  TaskStatus,
  type TaskStatusValue,
} from "./value-objects.ts";

interface MilestoneProps extends Record<string, unknown> {
  tenantId: string;
  projectId: string;
  name: string;
  dueDate: Date | null;
  position: number;
  completedAt: Date | null;
  createdAt: Date;
}

/** Entidade filha do agregado Project. */
export class Milestone extends Entity<MilestoneProps> {
  private constructor(id: string, props: MilestoneProps) {
    super(id, props);
  }

  static create(input: {
    id: string;
    tenantId: string;
    projectId: string;
    name: string;
    dueDate?: Date | null;
    position: number;
    now: Date;
  }): Milestone {
    return new Milestone(input.id, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      name: Guard.length(input.name, "name", 2, 120),
      dueDate: input.dueDate ?? null,
      position: input.position,
      completedAt: null,
      createdAt: input.now,
    });
  }

  static restore(id: string, props: MilestoneProps): Milestone {
    return new Milestone(id, props);
  }

  get tenantId(): string {
    return this.props.tenantId;
  }
  get projectId(): string {
    return this.props.projectId;
  }
  get name(): string {
    return this.props.name;
  }
  get dueDate(): Date | null {
    return this.props.dueDate;
  }
  get position(): number {
    return this.props.position;
  }
  get completedAt(): Date | null {
    return this.props.completedAt;
  }
  get isCompleted(): boolean {
    return this.props.completedAt !== null;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }

  complete(now: Date): void {
    if (this.props.completedAt) {
      throw new BusinessRuleError("Marco ja concluido", { milestoneId: this._id });
    }
    this.props.completedAt = now;
  }
}

interface ProjectProps extends Record<string, unknown> {
  tenantId: string;
  code: ProjectCode;
  name: string;
  description: string;
  status: ProjectStatus;
  startDate: Date | null;
  dueDate: Date | null;
  budget: Money;
  ownerId: string | null;
  clientCompanyId: string | null;
  archivedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  milestones: Milestone[];
}

/**
 * Projeto: raiz do agregado que governa marcos e serve de fronteira para as
 * tarefas. Projeto que nao aceita trabalho recusa novas tarefas.
 */
export class Project extends AggregateRoot<ProjectProps> {
  private newMilestones: Milestone[] = [];

  private constructor(id: string, props: ProjectProps) {
    super(id, props);
  }

  static create(input: {
    id: string;
    tenantId: string;
    code?: string;
    name: string;
    description?: string;
    startDate?: Date | null;
    dueDate?: Date | null;
    budgetCents?: number;
    currency?: string;
    ownerId?: string | null;
    clientCompanyId?: string | null;
    createdBy: string;
    now: Date;
  }): Project {
    if (input.startDate && input.dueDate) {
      Guard.rule(
        input.dueDate.getTime() >= input.startDate.getTime(),
        "O prazo do projeto nao pode ser anterior ao inicio",
        { startDate: input.startDate.toISOString(), dueDate: input.dueDate.toISOString() },
      );
    }

    const project = new Project(input.id, {
      tenantId: input.tenantId,
      code: input.code ? ProjectCode.create(input.code) : ProjectCode.fromName(input.name),
      name: Guard.length(input.name, "name", 2, 160),
      description: (input.description ?? "").slice(0, 4000),
      status: ProjectStatus.planning(),
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      budget: Money.fromCents(input.budgetCents ?? 0, input.currency ?? "BRL"),
      ownerId: input.ownerId ?? input.createdBy,
      clientCompanyId: input.clientCompanyId ?? null,
      archivedAt: null,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
      milestones: [],
    });
    project.record(new ProjectCreated(input.tenantId, input.id, project.code));
    return project;
  }

  static restore(id: string, props: ProjectProps): Project {
    return new Project(id, props);
  }

  override get tenantId(): string {
    return this.props.tenantId;
  }
  get code(): string {
    return this.props.code.value;
  }
  get name(): string {
    return this.props.name;
  }
  get description(): string {
    return this.props.description;
  }
  get status(): ProjectStatus {
    return this.props.status;
  }
  get startDate(): Date | null {
    return this.props.startDate;
  }
  get dueDate(): Date | null {
    return this.props.dueDate;
  }
  get budget(): Money {
    return this.props.budget;
  }
  get ownerId(): string | null {
    return this.props.ownerId;
  }
  get clientCompanyId(): string | null {
    return this.props.clientCompanyId;
  }
  get archivedAt(): Date | null {
    return this.props.archivedAt;
  }
  get createdBy(): string | null {
    return this.props.createdBy;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
  get milestones(): readonly Milestone[] {
    return this.props.milestones;
  }

  /** Regra usada pelo modulo ao criar tarefas neste projeto. */
  ensureAcceptsWork(): void {
    if (!this.props.status.acceptsWork) {
      throw new BusinessRuleError(
        `Projeto ${this.props.status.value}: nao aceita novas tarefas`,
        { projectId: this._id, status: this.props.status.value },
      );
    }
  }

  update(patch: Partial<{
    name: string;
    description: string;
    startDate: Date | null;
    dueDate: Date | null;
    budgetCents: number;
    currency: string;
    ownerId: string | null;
    clientCompanyId: string | null;
  }>, now: Date): void {
    if (this.props.status.isArchived) {
      throw new BusinessRuleError("Projeto arquivado nao pode ser alterado");
    }
    if (patch.name !== undefined) this.props.name = Guard.length(patch.name, "name", 2, 160);
    if (patch.description !== undefined) {
      this.props.description = patch.description.slice(0, 4000);
    }
    if (patch.startDate !== undefined) this.props.startDate = patch.startDate;
    if (patch.dueDate !== undefined) this.props.dueDate = patch.dueDate;
    if (patch.budgetCents !== undefined) {
      this.props.budget = Money.fromCents(
        patch.budgetCents,
        patch.currency ?? this.props.budget.currency,
      );
    }
    if (patch.ownerId !== undefined) this.props.ownerId = patch.ownerId;
    if (patch.clientCompanyId !== undefined) this.props.clientCompanyId = patch.clientCompanyId;

    if (this.props.startDate && this.props.dueDate) {
      Guard.rule(
        this.props.dueDate.getTime() >= this.props.startDate.getTime(),
        "O prazo do projeto nao pode ser anterior ao inicio",
      );
    }
    this.props.updatedAt = now;
  }

  changeStatus(next: ProjectStatusValue, now: Date): void {
    const from = this.props.status.value;
    this.props.status = this.props.status.transitionTo(next);
    this.props.archivedAt = next === "archived" ? now : null;
    this.props.updatedAt = now;
    this.record(new ProjectStatusChanged(this.tenantId, this._id, from, next));
  }

  addMilestone(input: { id: string; name: string; dueDate?: Date | null; now: Date }): Milestone {
    this.ensureAcceptsWork();
    const milestone = Milestone.create({
      id: input.id,
      tenantId: this.tenantId,
      projectId: this._id,
      name: input.name,
      dueDate: input.dueDate,
      position: this.props.milestones.length + 1,
      now: input.now,
    });
    this.props.milestones = [...this.props.milestones, milestone];
    this.newMilestones.push(milestone);
    this.props.updatedAt = input.now;
    return milestone;
  }

  pullNewMilestones(): Milestone[] {
    const pending = this.newMilestones;
    this.newMilestones = [];
    return pending;
  }
}

interface TaskCommentProps extends Record<string, unknown> {
  tenantId: string;
  taskId: string;
  authorId: string | null;
  body: string;
  createdAt: Date;
}

export class TaskComment extends Entity<TaskCommentProps> {
  private constructor(id: string, props: TaskCommentProps) {
    super(id, props);
  }

  static create(input: {
    id: string;
    tenantId: string;
    taskId: string;
    authorId: string;
    body: string;
    now: Date;
  }): TaskComment {
    return new TaskComment(input.id, {
      tenantId: input.tenantId,
      taskId: input.taskId,
      authorId: input.authorId,
      body: Guard.length(input.body, "body", 1, 4000),
      createdAt: input.now,
    });
  }

  static restore(id: string, props: TaskCommentProps): TaskComment {
    return new TaskComment(id, props);
  }

  get tenantId(): string {
    return this.props.tenantId;
  }
  get taskId(): string {
    return this.props.taskId;
  }
  get authorId(): string | null {
    return this.props.authorId;
  }
  get body(): string {
    return this.props.body;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
}

interface TimeEntryProps extends Record<string, unknown> {
  tenantId: string;
  projectId: string;
  taskId: string | null;
  userId: string;
  duration: Duration;
  spentOn: Date;
  notes: string;
  createdAt: Date;
}

export class TimeEntry extends Entity<TimeEntryProps> {
  private constructor(id: string, props: TimeEntryProps) {
    super(id, props);
  }

  static create(input: {
    id: string;
    tenantId: string;
    projectId: string;
    taskId: string | null;
    userId: string;
    minutes: number;
    spentOn?: Date;
    notes?: string;
    now: Date;
  }): TimeEntry {
    const spentOn = input.spentOn ?? input.now;
    Guard.rule(
      spentOn.getTime() <= input.now.getTime() + 86_400_000,
      "Nao e possivel apontar horas no futuro",
      { spentOn: spentOn.toISOString() },
    );
    return new TimeEntry(input.id, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      taskId: input.taskId,
      userId: input.userId,
      duration: Duration.ofMinutes(input.minutes),
      spentOn,
      notes: (input.notes ?? "").slice(0, 1000),
      createdAt: input.now,
    });
  }

  static restore(id: string, props: TimeEntryProps): TimeEntry {
    return new TimeEntry(id, props);
  }

  get tenantId(): string {
    return this.props.tenantId;
  }
  get projectId(): string {
    return this.props.projectId;
  }
  get taskId(): string | null {
    return this.props.taskId;
  }
  get userId(): string {
    return this.props.userId;
  }
  get duration(): Duration {
    return this.props.duration;
  }
  get spentOn(): Date {
    return this.props.spentOn;
  }
  get notes(): string {
    return this.props.notes;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
}

interface TaskProps extends Record<string, unknown> {
  tenantId: string;
  projectId: string;
  parentTaskId: string | null;
  milestoneId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  estimate: Duration;
  dueDate: Date | null;
  completedAt: Date | null;
  position: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  comments: TaskComment[];
  timeEntries: TimeEntry[];
}

/**
 * Tarefa: raiz do agregado que reune comentarios e apontamentos de horas.
 *
 * A regra que a define e a de conclusao: uma tarefa com subtarefa em aberto
 * nao pode ser concluida. Como as subtarefas sao outras raizes, quem conta e
 * um servico de dominio, e o resultado chega aqui como parametro.
 */
export class Task extends AggregateRoot<TaskProps> {
  private newComments: TaskComment[] = [];
  private newTimeEntries: TimeEntry[] = [];

  private constructor(id: string, props: TaskProps) {
    super(id, props);
  }

  static create(input: {
    id: string;
    tenantId: string;
    project: Project;
    parentTaskId?: string | null;
    milestoneId?: string | null;
    title: string;
    description?: string;
    priority?: string;
    assigneeId?: string | null;
    estimateMinutes?: number;
    dueDate?: Date | null;
    position?: number;
    createdBy: string;
    now: Date;
  }): Task {
    input.project.ensureAcceptsWork();

    const task = new Task(input.id, {
      tenantId: input.tenantId,
      projectId: input.project.id,
      parentTaskId: input.parentTaskId ?? null,
      milestoneId: input.milestoneId ?? null,
      title: Guard.length(input.title, "title", 2, 200),
      description: (input.description ?? "").slice(0, 4000),
      status: TaskStatus.todo(),
      priority: input.priority ? TaskPriority.create(input.priority) : TaskPriority.medium(),
      assigneeId: input.assigneeId ?? null,
      estimate: input.estimateMinutes
        ? Duration.ofMinutes(input.estimateMinutes, "estimateMinutes")
        : Duration.zero(),
      dueDate: input.dueDate ?? null,
      completedAt: null,
      position: input.position ?? 1,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
      comments: [],
      timeEntries: [],
    });
    task.record(new TaskCreated(input.tenantId, input.id, input.project.id, task.title));
    return task;
  }

  static restore(id: string, props: TaskProps): Task {
    return new Task(id, props);
  }

  override get tenantId(): string {
    return this.props.tenantId;
  }
  get projectId(): string {
    return this.props.projectId;
  }
  get parentTaskId(): string | null {
    return this.props.parentTaskId;
  }
  get milestoneId(): string | null {
    return this.props.milestoneId;
  }
  get title(): string {
    return this.props.title;
  }
  get description(): string {
    return this.props.description;
  }
  get status(): TaskStatus {
    return this.props.status;
  }
  get priority(): TaskPriority {
    return this.props.priority;
  }
  get assigneeId(): string | null {
    return this.props.assigneeId;
  }
  get estimate(): Duration {
    return this.props.estimate;
  }
  get dueDate(): Date | null {
    return this.props.dueDate;
  }
  get completedAt(): Date | null {
    return this.props.completedAt;
  }
  get position(): number {
    return this.props.position;
  }
  get createdBy(): string | null {
    return this.props.createdBy;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
  get comments(): readonly TaskComment[] {
    return this.props.comments;
  }
  get timeEntries(): readonly TimeEntry[] {
    return this.props.timeEntries;
  }

  get loggedMinutes(): number {
    return this.props.timeEntries.reduce((sum, entry) => sum + entry.duration.minutes, 0);
  }

  update(patch: Partial<{
    title: string;
    description: string;
    priority: string;
    estimateMinutes: number;
    dueDate: Date | null;
    milestoneId: string | null;
    position: number;
  }>, now: Date): void {
    if (patch.title !== undefined) this.props.title = Guard.length(patch.title, "title", 2, 200);
    if (patch.description !== undefined) {
      this.props.description = patch.description.slice(0, 4000);
    }
    if (patch.priority !== undefined) this.props.priority = TaskPriority.create(patch.priority);
    if (patch.estimateMinutes !== undefined) {
      this.props.estimate = Duration.ofMinutes(patch.estimateMinutes, "estimateMinutes");
    }
    if (patch.dueDate !== undefined) this.props.dueDate = patch.dueDate;
    if (patch.milestoneId !== undefined) this.props.milestoneId = patch.milestoneId;
    if (patch.position !== undefined) this.props.position = patch.position;
    this.props.updatedAt = now;
  }

  assignTo(assigneeId: string | null, now: Date): void {
    if (assigneeId === this.props.assigneeId) return;
    this.props.assigneeId = assigneeId;
    this.props.updatedAt = now;
    this.record(new TaskAssigned(this.tenantId, this._id, assigneeId));
  }

  /**
   * Muda o estado da tarefa. Concluir exige que nao haja subtarefa em aberto;
   * a contagem vem de fora porque cada subtarefa e uma raiz separada.
   */
  changeStatus(next: TaskStatusValue, openSubtasks: number, now: Date): void {
    if (next === "done" && openSubtasks > 0) {
      throw new BusinessRuleError(
        `Esta tarefa tem ${openSubtasks} subtarefa(s) em aberto`,
        { taskId: this._id, openSubtasks },
      );
    }

    const from = this.props.status.value;
    this.props.status = this.props.status.transitionTo(next);
    this.props.completedAt = this.props.status.isDone ? now : null;
    this.props.updatedAt = now;

    if (from !== next) {
      this.record(new TaskStatusChanged(this.tenantId, this._id, from, next));
    }
  }

  comment(input: { id: string; authorId: string; body: string; now: Date }): TaskComment {
    const comment = TaskComment.create({
      id: input.id,
      tenantId: this.tenantId,
      taskId: this._id,
      authorId: input.authorId,
      body: input.body,
      now: input.now,
    });
    this.props.comments = [...this.props.comments, comment];
    this.newComments.push(comment);
    this.props.updatedAt = input.now;
    return comment;
  }

  logTime(input: {
    id: string;
    userId: string;
    minutes: number;
    spentOn?: Date;
    notes?: string;
    now: Date;
  }): TimeEntry {
    if (!this.props.status.isOpen && !this.props.status.isDone) {
      throw new BusinessRuleError("Nao se apontam horas em tarefa cancelada");
    }
    const entry = TimeEntry.create({
      id: input.id,
      tenantId: this.tenantId,
      projectId: this.props.projectId,
      taskId: this._id,
      userId: input.userId,
      minutes: input.minutes,
      spentOn: input.spentOn,
      notes: input.notes,
      now: input.now,
    });
    this.props.timeEntries = [...this.props.timeEntries, entry];
    this.newTimeEntries.push(entry);
    this.props.updatedAt = input.now;
    this.record(
      new TimeLogged(this.tenantId, this._id, this.props.projectId, entry.duration.minutes, input.userId),
    );
    return entry;
  }

  pullNewComments(): TaskComment[] {
    const pending = this.newComments;
    this.newComments = [];
    return pending;
  }

  pullNewTimeEntries(): TimeEntry[] {
    const pending = this.newTimeEntries;
    this.newTimeEntries = [];
    return pending;
  }
}
