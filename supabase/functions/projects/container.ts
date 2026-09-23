import {
  type AuditTrail,
  type Clock,
  type EventPublisher,
  type IdGenerator,
  type Logger,
  type MembershipDirectory,
  type ModuleRuntime,
  OutboxEventPublisher,
  type RequestContext,
  SupabaseAuditTrail,
  SupabaseMembershipDirectory,
} from "../_shared/mod.ts";
import type { ProjectRepository, TaskRepository } from "./domain/ports.ts";
import { WorkAssignmentPolicy } from "./domain/services.ts";
import {
  SupabaseProjectRepository,
  SupabaseTaskRepository,
} from "./infrastructure/persistence/repositories.ts";
import {
  AddMilestoneUseCase,
  ChangeProjectStatusUseCase,
  CreateProjectUseCase,
  GetProjectSummaryUseCase,
  GetProjectUseCase,
  ListProjectsUseCase,
  UpdateProjectUseCase,
} from "./application/use-cases/projects.ts";
import {
  AssignTaskUseCase,
  ChangeTaskStatusUseCase,
  CommentTaskUseCase,
  CreateTaskUseCase,
  GetTaskUseCase,
  ListTasksUseCase,
  LogTimeUseCase,
  UpdateTaskUseCase,
} from "./application/use-cases/tasks.ts";

/** Raiz de composicao do modulo projects. */
export class ProjectsContainer {
  private readonly cache = new Map<string, unknown>();

  private constructor(
    readonly ctx: RequestContext,
    private readonly runtime: ModuleRuntime,
  ) {}

  static create(ctx: RequestContext, runtime: ModuleRuntime): ProjectsContainer {
    return new ProjectsContainer(ctx, runtime);
  }

  private lazy<T>(key: string, factory: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, factory());
    return this.cache.get(key) as T;
  }

  private get tenantId(): string {
    return this.ctx.tenantId ?? "";
  }
  private get projectsClient() {
    return this.runtime.connection.forActor(this.ctx, "projects");
  }

  get logger(): Logger {
    return this.lazy(
      "logger",
      () =>
        this.runtime.logger.child({ requestId: this.ctx.requestId, tenantId: this.ctx.tenantId }),
    );
  }
  get clock(): Clock {
    return this.runtime.clock;
  }
  get ids(): IdGenerator {
    return this.runtime.ids;
  }
  get events(): EventPublisher {
    return this.lazy(
      "events",
      () => new OutboxEventPublisher(this.runtime.connection.asService("core"), this.logger),
    );
  }
  get audit(): AuditTrail {
    return this.lazy(
      "audit",
      () =>
        new SupabaseAuditTrail(this.runtime.connection.asService("core"), this.ctx, this.logger),
    );
  }

  get projects(): ProjectRepository {
    return this.lazy(
      "projects",
      () => new SupabaseProjectRepository(this.projectsClient, this.tenantId),
    );
  }
  get tasks(): TaskRepository {
    return this.lazy("tasks", () => new SupabaseTaskRepository(this.projectsClient, this.tenantId));
  }
  get members(): MembershipDirectory {
    return this.lazy(
      "members",
      () => new SupabaseMembershipDirectory(this.runtime.connection.asService("core")),
    );
  }
  get assignmentPolicy(): WorkAssignmentPolicy {
    return this.lazy(
      "assignmentPolicy",
      () => new WorkAssignmentPolicy(this.members, this.tasks),
    );
  }

  get createProject(): CreateProjectUseCase {
    return this.lazy(
      "createProject",
      () => new CreateProjectUseCase(this.projects, this.ids, this.clock, this.events, this.audit),
    );
  }
  get listProjects(): ListProjectsUseCase {
    return this.lazy("listProjects", () => new ListProjectsUseCase(this.projects));
  }
  get getProject(): GetProjectUseCase {
    return this.lazy("getProject", () => new GetProjectUseCase(this.projects));
  }
  get updateProject(): UpdateProjectUseCase {
    return this.lazy(
      "updateProject",
      () => new UpdateProjectUseCase(this.projects, this.clock, this.audit),
    );
  }
  get changeProjectStatus(): ChangeProjectStatusUseCase {
    return this.lazy(
      "changeProjectStatus",
      () => new ChangeProjectStatusUseCase(this.projects, this.clock, this.events, this.audit),
    );
  }
  get addMilestone(): AddMilestoneUseCase {
    return this.lazy(
      "addMilestone",
      () => new AddMilestoneUseCase(this.projects, this.ids, this.clock, this.audit),
    );
  }
  get projectSummary(): GetProjectSummaryUseCase {
    return this.lazy("projectSummary", () => new GetProjectSummaryUseCase(this.projects));
  }

  get createTask(): CreateTaskUseCase {
    return this.lazy(
      "createTask",
      () =>
        new CreateTaskUseCase(
          this.tasks,
          this.projects,
          this.assignmentPolicy,
          this.ids,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get listTasks(): ListTasksUseCase {
    return this.lazy("listTasks", () => new ListTasksUseCase(this.tasks));
  }
  get getTask(): GetTaskUseCase {
    return this.lazy("getTask", () => new GetTaskUseCase(this.tasks));
  }
  get updateTask(): UpdateTaskUseCase {
    return this.lazy(
      "updateTask",
      () => new UpdateTaskUseCase(this.tasks, this.clock, this.audit),
    );
  }
  get assignTask(): AssignTaskUseCase {
    return this.lazy(
      "assignTask",
      () =>
        new AssignTaskUseCase(
          this.tasks,
          this.assignmentPolicy,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get changeTaskStatus(): ChangeTaskStatusUseCase {
    return this.lazy(
      "changeTaskStatus",
      () =>
        new ChangeTaskStatusUseCase(
          this.tasks,
          this.assignmentPolicy,
          this.clock,
          this.events,
          this.audit,
        ),
    );
  }
  get commentTask(): CommentTaskUseCase {
    return this.lazy(
      "commentTask",
      () => new CommentTaskUseCase(this.tasks, this.ids, this.clock, this.audit),
    );
  }
  get logTime(): LogTimeUseCase {
    return this.lazy(
      "logTime",
      () => new LogTimeUseCase(this.tasks, this.ids, this.clock, this.events, this.audit),
    );
  }
}
