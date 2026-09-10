import { V } from "../../_shared/mod.ts";
import { PROJECT_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from "../domain/value-objects.ts";
import type { Milestone, Project, Task, TaskComment, TimeEntry } from "../domain/entities.ts";
import type { ProjectSummary } from "../domain/ports.ts";

export const CreateProjectSchema = V.schema({
  name: V.text(2, 160),
  code: V.string().upper().matching(/^[A-Z][A-Z0-9-]{1,15}$/, "codigo de projeto").optional(),
  description: V.string().max(4000).default(""),
  startDate: V.date().optional(),
  dueDate: V.date().optional(),
  budgetCents: V.cents().default(0),
  currency: V.string().upper().matching(/^[A-Z]{3}$/, "ISO 4217").default("BRL"),
  ownerId: V.uuid().optional(),
  clientCompanyId: V.uuid().optional(),
});

export const UpdateProjectSchema = V.schema({
  id: V.uuid(),
  name: V.text(2, 160).optional(),
  description: V.string().max(4000).optional(),
  startDate: V.date().optional(),
  dueDate: V.date().optional(),
  budgetCents: V.cents().optional(),
  currency: V.string().upper().matching(/^[A-Z]{3}$/, "ISO 4217").optional(),
  ownerId: V.uuid().optional(),
  clientCompanyId: V.uuid().optional(),
});

export const ChangeProjectStatusSchema = V.schema({
  id: V.uuid(),
  status: V.enumOf(PROJECT_STATUSES),
});

export const CreateMilestoneSchema = V.schema({
  id: V.uuid(),
  name: V.text(2, 120),
  dueDate: V.date().optional(),
});

export const CreateTaskSchema = V.schema({
  projectId: V.uuid(),
  title: V.text(2, 200),
  description: V.string().max(4000).default(""),
  parentTaskId: V.uuid().optional(),
  milestoneId: V.uuid().optional(),
  priority: V.enumOf(TASK_PRIORITIES).default("medium"),
  assigneeId: V.uuid().optional(),
  estimateMinutes: V.integer().min(1).max(1440).optional(),
  dueDate: V.date().optional(),
});

export const UpdateTaskSchema = V.schema({
  id: V.uuid(),
  title: V.text(2, 200).optional(),
  description: V.string().max(4000).optional(),
  priority: V.enumOf(TASK_PRIORITIES).optional(),
  estimateMinutes: V.integer().min(1).max(1440).optional(),
  dueDate: V.date().optional(),
  milestoneId: V.uuid().optional(),
});

export const AssignTaskSchema = V.schema({ id: V.uuid(), assigneeId: V.uuid().optional() });
export const ChangeTaskStatusSchema = V.schema({ id: V.uuid(), status: V.enumOf(TASK_STATUSES) });
export const CommentTaskSchema = V.schema({ id: V.uuid(), body: V.text(1, 4000) });
export const LogTimeSchema = V.schema({
  id: V.uuid(),
  minutes: V.integer().min(1).max(1440),
  spentOn: V.date().optional(),
  notes: V.string().max(1000).default(""),
});
export const IdSchema = V.schema({ id: V.uuid() });

export class MilestonePresenter {
  static toDto(milestone: Milestone): Record<string, unknown> {
    return {
      id: milestone.id,
      projectId: milestone.projectId,
      name: milestone.name,
      dueDate: milestone.dueDate?.toISOString().slice(0, 10) ?? null,
      position: milestone.position,
      completedAt: milestone.completedAt?.toISOString() ?? null,
      isCompleted: milestone.isCompleted,
    };
  }
}

export class ProjectPresenter {
  static toDto(project: Project, includeMilestones = false): Record<string, unknown> {
    const dto: Record<string, unknown> = {
      id: project.id,
      tenantId: project.tenantId,
      code: project.code,
      name: project.name,
      description: project.description,
      status: project.status.value,
      startDate: project.startDate?.toISOString().slice(0, 10) ?? null,
      dueDate: project.dueDate?.toISOString().slice(0, 10) ?? null,
      budgetCents: project.budget.cents,
      currency: project.budget.currency,
      budgetFormatted: project.budget.format(),
      ownerId: project.ownerId,
      clientCompanyId: project.clientCompanyId,
      archivedAt: project.archivedAt?.toISOString() ?? null,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
    if (includeMilestones) {
      dto.milestones = project.milestones.map((m) => MilestonePresenter.toDto(m));
    }
    return dto;
  }

  static summaryToDto(summary: ProjectSummary): Record<string, unknown> {
    return {
      ...summary,
      loggedHours: Math.round((summary.loggedMinutes / 60) * 100) / 100,
      estimateHours: Math.round((summary.estimateMinutes / 60) * 100) / 100,
    };
  }
}

export class TaskCommentPresenter {
  static toDto(comment: TaskComment): Record<string, unknown> {
    return {
      id: comment.id,
      taskId: comment.taskId,
      authorId: comment.authorId,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };
  }
}

export class TimeEntryPresenter {
  static toDto(entry: TimeEntry): Record<string, unknown> {
    return {
      id: entry.id,
      projectId: entry.projectId,
      taskId: entry.taskId,
      userId: entry.userId,
      minutes: entry.duration.minutes,
      hours: entry.duration.hours,
      spentOn: entry.spentOn.toISOString().slice(0, 10),
      notes: entry.notes,
      createdAt: entry.createdAt.toISOString(),
    };
  }
}

export class TaskPresenter {
  static toDto(task: Task, includeChildren = false): Record<string, unknown> {
    const dto: Record<string, unknown> = {
      id: task.id,
      tenantId: task.tenantId,
      projectId: task.projectId,
      parentTaskId: task.parentTaskId,
      milestoneId: task.milestoneId,
      title: task.title,
      description: task.description,
      status: task.status.value,
      priority: task.priority.value,
      assigneeId: task.assigneeId,
      estimateMinutes: task.estimate.minutes,
      dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      position: task.position,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
    if (includeChildren) {
      dto.loggedMinutes = task.loggedMinutes;
      dto.comments = task.comments.map((c) => TaskCommentPresenter.toDto(c));
      dto.timeEntries = task.timeEntries.map((e) => TimeEntryPresenter.toDto(e));
    }
    return dto;
  }
}
