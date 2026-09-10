import {
  Controller,
  HttpResponse,
  type HttpRequest,
  type RequestContext,
  type Router,
} from "../../../_shared/mod.ts";
import type { ProjectsContainer } from "../../container.ts";
import {
  AssignTaskSchema,
  ChangeProjectStatusSchema,
  ChangeTaskStatusSchema,
  CommentTaskSchema,
  CreateMilestoneSchema,
  CreateProjectSchema,
  CreateTaskSchema,
  IdSchema,
  LogTimeSchema,
  UpdateProjectSchema,
  UpdateTaskSchema,
} from "../../application/dto.ts";

export class ProjectController extends Controller {
  constructor(private readonly container: ProjectsContainer) {
    super();
  }

  override register(router: Router): void {
    router.post("/projects", (req, ctx) => this.create(req, ctx));
    router.get("/projects", (req, ctx) => this.list(req, ctx));
    router.get("/projects/:id", (req, ctx) => this.get(req, ctx));
    router.patch("/projects/:id", (req, ctx) => this.update(req, ctx));
    router.get("/projects/:id/summary", (req, ctx) => this.summary(req, ctx));
    router.post("/projects/:id/status", (req, ctx) => this.changeStatus(req, ctx));
    router.post("/projects/:id/archive", (req, ctx) => this.archive(req, ctx));
    router.post("/projects/:id/milestones", (req, ctx) => this.addMilestone(req, ctx));
  }

  private async create(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.created(
      await this.container.createProject.execute(CreateProjectSchema.parse(req.body), ctx),
    );
  }

  private async list(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const filter = {
      status: req.queryValue("status") ?? undefined,
      ownerId: req.queryValue("ownerId") ?? undefined,
      search: req.queryValue("search") ?? undefined,
    };
    return HttpResponse.ok(
      await this.container.listProjects.execute({ filter, page: req.pageRequest() }, ctx),
    );
  }

  private async get(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.getProject.execute(IdSchema.parse(req.payload()), ctx),
    );
  }

  private async update(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.updateProject.execute(UpdateProjectSchema.parse(req.payload()), ctx),
    );
  }

  private async summary(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.projectSummary.execute(IdSchema.parse(req.payload()), ctx),
    );
  }

  private async changeStatus(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.changeProjectStatus.execute(
        ChangeProjectStatusSchema.parse(req.payload()),
        ctx,
      ),
    );
  }

  private async archive(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const input = { ...IdSchema.parse(req.payload()), status: "archived" as const };
    return HttpResponse.ok(await this.container.changeProjectStatus.execute(input, ctx));
  }

  private async addMilestone(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.created(
      await this.container.addMilestone.execute(CreateMilestoneSchema.parse(req.payload()), ctx),
    );
  }
}

export class TaskController extends Controller {
  constructor(private readonly container: ProjectsContainer) {
    super();
  }

  override register(router: Router): void {
    router.post("/tasks", (req, ctx) => this.create(req, ctx));
    router.get("/tasks", (req, ctx) => this.list(req, ctx));
    router.get("/tasks/:id", (req, ctx) => this.get(req, ctx));
    router.patch("/tasks/:id", (req, ctx) => this.update(req, ctx));
    router.post("/tasks/:id/assign", (req, ctx) => this.assign(req, ctx));
    router.post("/tasks/:id/status", (req, ctx) => this.changeStatus(req, ctx));
    router.post("/tasks/:id/comments", (req, ctx) => this.comment(req, ctx));
    router.post("/tasks/:id/time-entries", (req, ctx) => this.logTime(req, ctx));
  }

  private async create(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.created(
      await this.container.createTask.execute(CreateTaskSchema.parse(req.body), ctx),
    );
  }

  private async list(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const filter = {
      projectId: req.queryValue("projectId") ?? undefined,
      status: req.queryValue("status") ?? undefined,
      assigneeId: req.queryValue("assigneeId") ?? undefined,
      parentTaskId: req.queryValue("parentTaskId") ?? undefined,
      search: req.queryValue("search") ?? undefined,
    };
    return HttpResponse.ok(
      await this.container.listTasks.execute({ filter, page: req.pageRequest() }, ctx),
    );
  }

  private async get(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.getTask.execute(IdSchema.parse(req.payload()), ctx),
    );
  }

  private async update(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.updateTask.execute(UpdateTaskSchema.parse(req.payload()), ctx),
    );
  }

  private async assign(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.assignTask.execute(AssignTaskSchema.parse(req.payload()), ctx),
    );
  }

  private async changeStatus(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.changeTaskStatus.execute(
        ChangeTaskStatusSchema.parse(req.payload()),
        ctx,
      ),
    );
  }

  private async comment(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.created(
      await this.container.commentTask.execute(CommentTaskSchema.parse(req.payload()), ctx),
    );
  }

  private async logTime(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.created(
      await this.container.logTime.execute(LogTimeSchema.parse(req.payload()), ctx),
    );
  }
}
