import { DomainEvent } from "../../_shared/mod.ts";

export class ProjectCreated extends DomainEvent {
  constructor(tenantId: string, projectId: string, readonly code: string) {
    super(tenantId, projectId);
  }
  override get name(): string {
    return "projects.project.created";
  }
  override get aggregateType(): string {
    return "Project";
  }
  override payload(): Record<string, unknown> {
    return { code: this.code };
  }
}

export class ProjectStatusChanged extends DomainEvent {
  constructor(tenantId: string, projectId: string, readonly from: string, readonly to: string) {
    super(tenantId, projectId);
  }
  override get name(): string {
    return `projects.project.${this.to}`;
  }
  override get aggregateType(): string {
    return "Project";
  }
  override payload(): Record<string, unknown> {
    return { from: this.from, to: this.to };
  }
}

export class TaskCreated extends DomainEvent {
  constructor(
    tenantId: string,
    taskId: string,
    readonly projectId: string,
    readonly title: string,
  ) {
    super(tenantId, taskId);
  }
  override get name(): string {
    return "projects.task.created";
  }
  override get aggregateType(): string {
    return "Task";
  }
  override payload(): Record<string, unknown> {
    return { projectId: this.projectId, title: this.title };
  }
}

export class TaskAssigned extends DomainEvent {
  constructor(tenantId: string, taskId: string, readonly assigneeId: string | null) {
    super(tenantId, taskId);
  }
  override get name(): string {
    return "projects.task.assigned";
  }
  override get aggregateType(): string {
    return "Task";
  }
  override payload(): Record<string, unknown> {
    return { assigneeId: this.assigneeId };
  }
}

export class TaskStatusChanged extends DomainEvent {
  constructor(tenantId: string, taskId: string, readonly from: string, readonly to: string) {
    super(tenantId, taskId);
  }
  override get name(): string {
    return "projects.task.status_changed";
  }
  override get aggregateType(): string {
    return "Task";
  }
  override payload(): Record<string, unknown> {
    return { from: this.from, to: this.to };
  }
}

export class TimeLogged extends DomainEvent {
  constructor(
    tenantId: string,
    taskId: string,
    readonly projectId: string,
    readonly minutes: number,
    readonly userId: string,
  ) {
    super(tenantId, taskId);
  }
  override get name(): string {
    return "projects.time_entry.logged";
  }
  override get aggregateType(): string {
    return "Task";
  }
  override payload(): Record<string, unknown> {
    return { projectId: this.projectId, minutes: this.minutes, userId: this.userId };
  }
}
