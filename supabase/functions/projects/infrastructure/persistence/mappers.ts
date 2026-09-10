import { Mapper, Money } from "../../../_shared/mod.ts";
import { Milestone, Project, Task, TaskComment, TimeEntry } from "../../domain/entities.ts";
import {
  Duration,
  ProjectCode,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from "../../domain/value-objects.ts";

export interface MilestoneRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  project_id: string;
  name: string;
  due_date: string | null;
  position: number;
  completed_at: string | null;
  created_at: string;
}

export class MilestoneMapper extends Mapper<Milestone, MilestoneRow> {
  override toDomain(row: MilestoneRow): Milestone {
    return Milestone.restore(row.id, {
      tenantId: row.tenant_id,
      projectId: row.project_id,
      name: row.name,
      dueDate: row.due_date ? new Date(row.due_date) : null,
      position: row.position,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      createdAt: new Date(row.created_at),
    });
  }

  override toRow(milestone: Milestone): Record<string, unknown> {
    return {
      id: milestone.id,
      tenant_id: milestone.tenantId,
      project_id: milestone.projectId,
      name: milestone.name,
      due_date: milestone.dueDate ? milestone.dueDate.toISOString().slice(0, 10) : null,
      position: milestone.position,
      completed_at: milestone.completedAt?.toISOString() ?? null,
    };
  }
}

export interface ProjectRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description: string;
  status: string;
  start_date: string | null;
  due_date: string | null;
  budget_cents: number;
  currency: string;
  owner_id: string | null;
  client_company_id: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  milestones?: MilestoneRow[] | null;
}

export class ProjectMapper extends Mapper<Project, ProjectRow> {
  private readonly milestoneMapper = new MilestoneMapper();

  override toDomain(row: ProjectRow): Project {
    return Project.restore(row.id, {
      tenantId: row.tenant_id,
      code: ProjectCode.create(row.code),
      name: row.name,
      description: row.description ?? "",
      status: ProjectStatus.create(row.status),
      startDate: row.start_date ? new Date(row.start_date) : null,
      dueDate: row.due_date ? new Date(row.due_date) : null,
      budget: Money.fromCents(Number(row.budget_cents), row.currency),
      ownerId: row.owner_id,
      clientCompanyId: row.client_company_id,
      archivedAt: row.archived_at ? new Date(row.archived_at) : null,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      milestones: this.milestoneMapper.toDomainList(row.milestones ?? []),
    });
  }

  override toRow(project: Project): Record<string, unknown> {
    return {
      id: project.id,
      tenant_id: project.tenantId,
      code: project.code,
      name: project.name,
      description: project.description,
      status: project.status.value,
      start_date: project.startDate ? project.startDate.toISOString().slice(0, 10) : null,
      due_date: project.dueDate ? project.dueDate.toISOString().slice(0, 10) : null,
      budget_cents: project.budget.cents,
      currency: project.budget.currency,
      owner_id: project.ownerId,
      client_company_id: project.clientCompanyId,
      archived_at: project.archivedAt?.toISOString() ?? null,
      created_by: project.createdBy,
    };
  }
}

export interface TaskCommentRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export class TaskCommentMapper extends Mapper<TaskComment, TaskCommentRow> {
  override toDomain(row: TaskCommentRow): TaskComment {
    return TaskComment.restore(row.id, {
      tenantId: row.tenant_id,
      taskId: row.task_id,
      authorId: row.author_id,
      body: row.body,
      createdAt: new Date(row.created_at),
    });
  }

  override toRow(comment: TaskComment): Record<string, unknown> {
    return {
      id: comment.id,
      tenant_id: comment.tenantId,
      task_id: comment.taskId,
      author_id: comment.authorId,
      body: comment.body,
    };
  }
}

export interface TimeEntryRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  project_id: string;
  task_id: string | null;
  user_id: string;
  minutes: number;
  spent_on: string;
  notes: string;
  created_at: string;
}

export class TimeEntryMapper extends Mapper<TimeEntry, TimeEntryRow> {
  override toDomain(row: TimeEntryRow): TimeEntry {
    return TimeEntry.restore(row.id, {
      tenantId: row.tenant_id,
      projectId: row.project_id,
      taskId: row.task_id,
      userId: row.user_id,
      duration: Duration.ofMinutes(row.minutes),
      spentOn: new Date(row.spent_on),
      notes: row.notes ?? "",
      createdAt: new Date(row.created_at),
    });
  }

  override toRow(entry: TimeEntry): Record<string, unknown> {
    return {
      id: entry.id,
      tenant_id: entry.tenantId,
      project_id: entry.projectId,
      task_id: entry.taskId,
      user_id: entry.userId,
      minutes: entry.duration.minutes,
      spent_on: entry.spentOn.toISOString().slice(0, 10),
      notes: entry.notes,
    };
  }
}

export interface TaskRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  project_id: string;
  parent_task_id: string | null;
  milestone_id: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee_id: string | null;
  estimate_minutes: number;
  due_date: string | null;
  completed_at: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  task_comments?: TaskCommentRow[] | null;
  time_entries?: TimeEntryRow[] | null;
}

export class TaskMapper extends Mapper<Task, TaskRow> {
  private readonly commentMapper = new TaskCommentMapper();
  private readonly timeMapper = new TimeEntryMapper();

  override toDomain(row: TaskRow): Task {
    return Task.restore(row.id, {
      tenantId: row.tenant_id,
      projectId: row.project_id,
      parentTaskId: row.parent_task_id,
      milestoneId: row.milestone_id,
      title: row.title,
      description: row.description ?? "",
      status: TaskStatus.create(row.status),
      priority: TaskPriority.create(row.priority),
      assigneeId: row.assignee_id,
      estimate: row.estimate_minutes > 0
        ? Duration.ofMinutes(row.estimate_minutes, "estimateMinutes")
        : Duration.zero(),
      dueDate: row.due_date ? new Date(row.due_date) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      position: row.position,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      comments: this.commentMapper.toDomainList(row.task_comments ?? []),
      timeEntries: this.timeMapper.toDomainList(row.time_entries ?? []),
    });
  }

  override toRow(task: Task): Record<string, unknown> {
    return {
      id: task.id,
      tenant_id: task.tenantId,
      project_id: task.projectId,
      parent_task_id: task.parentTaskId,
      milestone_id: task.milestoneId,
      title: task.title,
      description: task.description,
      status: task.status.value,
      priority: task.priority.value,
      assignee_id: task.assigneeId,
      estimate_minutes: task.estimate.minutes,
      due_date: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
      completed_at: task.completedAt?.toISOString() ?? null,
      position: task.position,
      created_by: task.createdBy,
    };
  }
}
