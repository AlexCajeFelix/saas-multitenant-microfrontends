import {
  type Db,
  InfrastructureError,
  Mapper,
  NotFoundError,
  type Page,
  type PageRequest,
  SupabaseRepository,
} from "../../../_shared/mod.ts";
import type { Project, Task } from "../../domain/entities.ts";
import type {
  ProjectFilter,
  ProjectRepository,
  ProjectSummary,
  TaskFilter,
  TaskRepository,
} from "../../domain/ports.ts";
import {
  MilestoneMapper,
  ProjectMapper,
  type ProjectRow,
  TaskCommentMapper,
  TaskMapper,
  type TaskRow,
  TimeEntryMapper,
} from "./mappers.ts";

function likeTerm(search: string): string {
  return `%${search.replace(/[%_,()]/g, " ").trim()}%`;
}

export class SupabaseProjectRepository extends SupabaseRepository<Project, ProjectRow>
  implements ProjectRepository {
  private readonly projectMapper = new ProjectMapper();
  private readonly milestoneMapper = new MilestoneMapper();

  constructor(client: Db, tenantId: string) {
    super(client, tenantId);
  }

  protected override get tableName(): string {
    return "projects";
  }
  protected override get resourceName(): string {
    return "Projeto";
  }
  protected override get mapper(): Mapper<Project, ProjectRow> {
    return this.projectMapper;
  }

  override async getById(id: string, withMilestones = false): Promise<Project> {
    const columns = withMilestones ? "*, milestones(*)" : "*";
    const { data, error } = await this.scoped(columns).eq("id", id).maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundError("Projeto", id);
    return this.projectMapper.toDomain(data as unknown as ProjectRow);
  }

  async findByCode(code: string): Promise<Project | null> {
    const { data, error } = await this.scoped().ilike("code", code).maybeSingle();
    if (error) this.fail(error);
    return data ? this.projectMapper.toDomain(data as unknown as ProjectRow) : null;
  }

  async search(filter: ProjectFilter, page: PageRequest): Promise<Page<Project>> {
    let query = this.countingQuery();
    if (filter.status) query = query.eq("status", filter.status);
    if (filter.ownerId) query = query.eq("owner_id", filter.ownerId);
    if (filter.search) {
      const term = likeTerm(filter.search);
      query = query.or(`name.ilike.${term},code.ilike.${term}`);
    }
    return await this.paginate(query, page);
  }

  async save(project: Project): Promise<Project> {
    const saved = await super.update(project, project.id);
    const pending = project.pullNewMilestones();
    if (pending.length > 0) {
      const { error } = await this.client
        .from("milestones")
        .insert(pending.map((milestone) => this.milestoneMapper.toRow(milestone)));
      if (error) this.fail(error);
    }
    return saved;
  }

  async summary(projectId: string): Promise<ProjectSummary> {
    const { data, error } = await this.client.rpc("project_summary", { p_project: projectId });
    if (error) throw new InfrastructureError(`Falha ao resumir o projeto: ${error.message}`);
    if (!data) throw new NotFoundError("Projeto", projectId);
    return data as unknown as ProjectSummary;
  }
}

/**
 * Repositorio do agregado Task: grava a raiz e, junto, os comentarios e
 * apontamentos novos que o agregado acumulou.
 */
export class SupabaseTaskRepository extends SupabaseRepository<Task, TaskRow>
  implements TaskRepository {
  private readonly taskMapper = new TaskMapper();
  private readonly commentMapper = new TaskCommentMapper();
  private readonly timeMapper = new TimeEntryMapper();

  constructor(client: Db, tenantId: string) {
    super(client, tenantId);
  }

  protected override get tableName(): string {
    return "tasks";
  }
  protected override get resourceName(): string {
    return "Tarefa";
  }
  protected override get mapper(): Mapper<Task, TaskRow> {
    return this.taskMapper;
  }

  override async getById(id: string, withChildren = false): Promise<Task> {
    const columns = withChildren ? "*, task_comments(*), time_entries(*)" : "*";
    const { data, error } = await this.scoped(columns).eq("id", id).maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundError("Tarefa", id);
    return this.taskMapper.toDomain(data as unknown as TaskRow);
  }

  async search(filter: TaskFilter, page: PageRequest): Promise<Page<Task>> {
    let query = this.countingQuery();
    if (filter.projectId) query = query.eq("project_id", filter.projectId);
    if (filter.status) query = query.eq("status", filter.status);
    if (filter.assigneeId) query = query.eq("assignee_id", filter.assigneeId);
    if (filter.parentTaskId) query = query.eq("parent_task_id", filter.parentTaskId);
    if (filter.search) query = query.ilike("title", likeTerm(filter.search));
    return await this.paginate(query, page);
  }

  async countOpenSubtasks(parentTaskId: string): Promise<number> {
    const { count, error } = await this.table
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", this.tenantId)
      .eq("parent_task_id", parentTaskId)
      .in("status", ["todo", "in_progress", "blocked"]);
    if (error) this.fail(error);
    return count ?? 0;
  }

  async save(task: Task): Promise<Task> {
    const saved = await super.update(task, task.id);

    const comments = task.pullNewComments();
    if (comments.length > 0) {
      const { error } = await this.client
        .from("task_comments")
        .insert(comments.map((comment) => this.commentMapper.toRow(comment)));
      if (error) this.fail(error);
    }

    const entries = task.pullNewTimeEntries();
    if (entries.length > 0) {
      const { error } = await this.client
        .from("time_entries")
        .insert(entries.map((entry) => this.timeMapper.toRow(entry)));
      if (error) this.fail(error);
    }

    return saved;
  }
}
