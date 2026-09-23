import {
  type AuditTrail,
  BaseUseCase,
  type Clock,
  type EventPublisher,
  type IdGenerator,
  type Page,
  type PageRequest,
  type RequestContext,
} from "../../../_shared/mod.ts";
import { Task } from "../../domain/entities.ts";
import type { ProjectRepository, TaskFilter, TaskRepository } from "../../domain/ports.ts";
import type { WorkAssignmentPolicy } from "../../domain/services.ts";
import type { TaskStatusValue } from "../../domain/value-objects.ts";
import { TaskCommentPresenter, TaskPresenter, TimeEntryPresenter } from "../dto.ts";

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description: string;
  parentTaskId?: string;
  milestoneId?: string;
  priority: string;
  assigneeId?: string;
  estimateMinutes?: number;
  dueDate?: Date;
}

export class CreateTaskUseCase extends BaseUseCase<CreateTaskInput, Record<string, unknown>> {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly projects: ProjectRepository,
    private readonly policy: WorkAssignmentPolicy,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "projects.task.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: CreateTaskInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.requireTenantId();
    const project = await this.projects.getById(input.projectId);
    await this.policy.ensureAssignable(tenantId, input.assigneeId ?? null);
    if (input.parentTaskId) await this.tasks.getById(input.parentTaskId);

    const task = Task.create({
      id: this.ids.generate(),
      tenantId,
      project,
      createdBy: ctx.requireUserId(),
      now: this.clock.now(),
      title: input.title,
      description: input.description,
      parentTaskId: input.parentTaskId,
      milestoneId: input.milestoneId,
      priority: input.priority,
      assigneeId: input.assigneeId,
      estimateMinutes: input.estimateMinutes,
      dueDate: input.dueDate ?? null,
    });

    const saved = await this.tasks.insert(task);
    await this.events.publish(task.pullEvents());
    await this.audit.record({
      action: "task.created",
      resourceType: "task",
      resourceId: saved.id,
      metadata: { projectId: saved.projectId, title: saved.title },
    });
    return TaskPresenter.toDto(saved);
  }
}

export class ListTasksUseCase
  extends BaseUseCase<{ filter: TaskFilter; page: PageRequest }, Record<string, unknown>> {
  constructor(private readonly tasks: TaskRepository) {
    super();
  }
  protected override get permission(): string | null {
    return "projects.task.read";
  }
  protected override async handle(
    input: { filter: TaskFilter; page: PageRequest },
  ): Promise<Record<string, unknown>> {
    const result: Page<unknown> = (await this.tasks.search(input.filter, input.page))
      .map((task) => TaskPresenter.toDto(task));
    return result.toJSON();
  }
}

export class GetTaskUseCase extends BaseUseCase<{ id: string }, Record<string, unknown>> {
  constructor(private readonly tasks: TaskRepository) {
    super();
  }
  protected override get permission(): string | null {
    return "projects.task.read";
  }
  protected override async handle(input: { id: string }): Promise<Record<string, unknown>> {
    return TaskPresenter.toDto(await this.tasks.getById(input.id, true), true);
  }
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  description?: string;
  priority?: string;
  estimateMinutes?: number;
  dueDate?: Date;
  milestoneId?: string;
}

export class UpdateTaskUseCase extends BaseUseCase<UpdateTaskInput, Record<string, unknown>> {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly clock: Clock,
    private readonly audit: AuditTrail,
  ) {
    super();
  }
  protected override get permission(): string | null {
    return "projects.task.write";
  }
  protected override get mutating(): boolean {
    return true;
  }
  protected override async handle(input: UpdateTaskInput): Promise<Record<string, unknown>> {
    const { id, ...patch } = input;
    const task = await this.tasks.getById(id);
    task.update(patch, this.clock.now());
    const saved = await this.tasks.save(task);
    await this.audit.record({
      action: "task.updated",
      resourceType: "task",
      resourceId: id,
      metadata: { fields: Object.keys(patch) },
    });
    return TaskPresenter.toDto(saved);
  }
}

export class AssignTaskUseCase
  extends BaseUseCase<{ id: string; assigneeId?: string }, Record<string, unknown>> {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly policy: WorkAssignmentPolicy,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }
  protected override get permission(): string | null {
    return "projects.task.write";
  }
  protected override get mutating(): boolean {
    return true;
  }
  protected override async handle(
    input: { id: string; assigneeId?: string },
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const assigneeId = input.assigneeId ?? null;
    await this.policy.ensureAssignable(ctx.requireTenantId(), assigneeId);

    const task = await this.tasks.getById(input.id);
    task.assignTo(assigneeId, this.clock.now());
    const saved = await this.tasks.save(task);

    await this.events.publish(task.pullEvents());
    await this.audit.record({
      action: "task.assigned",
      resourceType: "task",
      resourceId: saved.id,
      metadata: { assigneeId },
    });
    return TaskPresenter.toDto(saved);
  }
}

/** Muda o estado da tarefa consultando antes as subtarefas em aberto. */
export class ChangeTaskStatusUseCase
  extends BaseUseCase<{ id: string; status: TaskStatusValue }, Record<string, unknown>> {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly policy: WorkAssignmentPolicy,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }
  protected override get permission(): string | null {
    return "projects.task.write";
  }
  protected override get mutating(): boolean {
    return true;
  }
  protected override async handle(
    input: { id: string; status: TaskStatusValue },
  ): Promise<Record<string, unknown>> {
    const task = await this.tasks.getById(input.id);
    const openSubtasks = input.status === "done" ? await this.policy.countOpenSubtasks(task.id) : 0;

    task.changeStatus(input.status, openSubtasks, this.clock.now());
    const saved = await this.tasks.save(task);

    await this.events.publish(task.pullEvents());
    await this.audit.record({
      action: "task.status_changed",
      resourceType: "task",
      resourceId: saved.id,
      metadata: { status: input.status },
    });
    return TaskPresenter.toDto(saved);
  }
}

export class CommentTaskUseCase
  extends BaseUseCase<{ id: string; body: string }, Record<string, unknown>> {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly audit: AuditTrail,
  ) {
    super();
  }
  protected override get permission(): string | null {
    return "projects.comment.write";
  }
  protected override get mutating(): boolean {
    return true;
  }
  protected override async handle(
    input: { id: string; body: string },
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const task = await this.tasks.getById(input.id);
    const comment = task.comment({
      id: this.ids.generate(),
      authorId: ctx.requireUserId(),
      body: input.body,
      now: this.clock.now(),
    });
    await this.tasks.save(task);
    await this.audit.record({
      action: "task.commented",
      resourceType: "task_comment",
      resourceId: comment.id,
      metadata: { taskId: task.id },
    });
    return TaskCommentPresenter.toDto(comment);
  }
}

export interface LogTimeInput {
  id: string;
  minutes: number;
  spentOn?: Date;
  notes: string;
}

export class LogTimeUseCase extends BaseUseCase<LogTimeInput, Record<string, unknown>> {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }
  protected override get permission(): string | null {
    return "projects.time_entry.write";
  }
  protected override get mutating(): boolean {
    return true;
  }
  protected override async handle(
    input: LogTimeInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const task = await this.tasks.getById(input.id);
    const entry = task.logTime({
      id: this.ids.generate(),
      userId: ctx.requireUserId(),
      minutes: input.minutes,
      spentOn: input.spentOn,
      notes: input.notes,
      now: this.clock.now(),
    });

    await this.tasks.save(task);
    await this.events.publish(task.pullEvents());
    await this.audit.record({
      action: "time_entry.logged",
      resourceType: "time_entry",
      resourceId: entry.id,
      metadata: { taskId: task.id, minutes: entry.duration.minutes },
    });
    return TimeEntryPresenter.toDto(entry);
  }
}
