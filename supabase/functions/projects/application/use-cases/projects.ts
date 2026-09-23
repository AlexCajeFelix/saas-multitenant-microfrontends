import {
  type AuditTrail,
  BaseUseCase,
  type Clock,
  ConflictError,
  type EventPublisher,
  type IdGenerator,
  type Page,
  type PageRequest,
  type RequestContext,
} from "../../../_shared/mod.ts";
import { Project } from "../../domain/entities.ts";
import type { ProjectFilter, ProjectRepository } from "../../domain/ports.ts";
import type { ProjectStatusValue } from "../../domain/value-objects.ts";
import { MilestonePresenter, ProjectPresenter } from "../dto.ts";

export interface CreateProjectInput {
  name: string;
  code?: string;
  description: string;
  startDate?: Date;
  dueDate?: Date;
  budgetCents: number;
  currency: string;
  ownerId?: string;
  clientCompanyId?: string;
}

export class CreateProjectUseCase extends BaseUseCase<CreateProjectInput, Record<string, unknown>> {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "projects.project.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: CreateProjectInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const project = Project.create({
      id: this.ids.generate(),
      tenantId: ctx.requireTenantId(),
      createdBy: ctx.requireUserId(),
      now: this.clock.now(),
      name: input.name,
      code: input.code,
      description: input.description,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      budgetCents: input.budgetCents,
      currency: input.currency,
      ownerId: input.ownerId,
      clientCompanyId: input.clientCompanyId,
    });

    if (await this.projects.findByCode(project.code)) {
      throw new ConflictError("Ja existe um projeto com este codigo", { code: project.code });
    }

    const saved = await this.projects.insert(project);
    await this.events.publish(project.pullEvents());
    await this.audit.record({
      action: "project.created",
      resourceType: "project",
      resourceId: saved.id,
      metadata: { code: saved.code },
    });
    return ProjectPresenter.toDto(saved);
  }
}

export class ListProjectsUseCase
  extends BaseUseCase<{ filter: ProjectFilter; page: PageRequest }, Record<string, unknown>> {
  constructor(private readonly projects: ProjectRepository) {
    super();
  }
  protected override get permission(): string | null {
    return "projects.project.read";
  }
  protected override async handle(
    input: { filter: ProjectFilter; page: PageRequest },
  ): Promise<Record<string, unknown>> {
    const result: Page<unknown> = (await this.projects.search(input.filter, input.page))
      .map((project) => ProjectPresenter.toDto(project));
    return result.toJSON();
  }
}

export class GetProjectUseCase extends BaseUseCase<{ id: string }, Record<string, unknown>> {
  constructor(private readonly projects: ProjectRepository) {
    super();
  }
  protected override get permission(): string | null {
    return "projects.project.read";
  }
  protected override async handle(input: { id: string }): Promise<Record<string, unknown>> {
    return ProjectPresenter.toDto(await this.projects.getById(input.id, true), true);
  }
}

export interface UpdateProjectInput extends Partial<CreateProjectInput> {
  id: string;
}

export class UpdateProjectUseCase extends BaseUseCase<UpdateProjectInput, Record<string, unknown>> {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly clock: Clock,
    private readonly audit: AuditTrail,
  ) {
    super();
  }
  protected override get permission(): string | null {
    return "projects.project.write";
  }
  protected override get mutating(): boolean {
    return true;
  }
  protected override async handle(input: UpdateProjectInput): Promise<Record<string, unknown>> {
    const { id, code: _code, ...patch } = input;
    const project = await this.projects.getById(id);
    project.update(patch, this.clock.now());
    const saved = await this.projects.save(project);
    await this.audit.record({
      action: "project.updated",
      resourceType: "project",
      resourceId: id,
      metadata: { fields: Object.keys(patch) },
    });
    return ProjectPresenter.toDto(saved);
  }
}

export class ChangeProjectStatusUseCase
  extends BaseUseCase<{ id: string; status: ProjectStatusValue }, Record<string, unknown>> {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }
  protected override get permission(): string | null {
    return "projects.project.write";
  }
  protected override get mutating(): boolean {
    return true;
  }
  protected override async handle(
    input: { id: string; status: ProjectStatusValue },
  ): Promise<Record<string, unknown>> {
    const project = await this.projects.getById(input.id);
    project.changeStatus(input.status, this.clock.now());
    const saved = await this.projects.save(project);
    await this.events.publish(project.pullEvents());
    await this.audit.record({
      action: `project.${input.status}`,
      resourceType: "project",
      resourceId: saved.id,
    });
    return ProjectPresenter.toDto(saved);
  }
}

export interface AddMilestoneInput {
  id: string;
  name: string;
  dueDate?: Date;
}

export class AddMilestoneUseCase extends BaseUseCase<AddMilestoneInput, Record<string, unknown>> {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly audit: AuditTrail,
  ) {
    super();
  }
  protected override get permission(): string | null {
    return "projects.milestone.write";
  }
  protected override get mutating(): boolean {
    return true;
  }
  protected override async handle(input: AddMilestoneInput): Promise<Record<string, unknown>> {
    const project = await this.projects.getById(input.id, true);
    const milestone = project.addMilestone({
      id: this.ids.generate(),
      name: input.name,
      dueDate: input.dueDate ?? null,
      now: this.clock.now(),
    });
    await this.projects.save(project);
    await this.audit.record({
      action: "milestone.created",
      resourceType: "milestone",
      resourceId: milestone.id,
      metadata: { projectId: project.id, name: milestone.name },
    });
    return MilestonePresenter.toDto(milestone);
  }
}

export class GetProjectSummaryUseCase extends BaseUseCase<{ id: string }, Record<string, unknown>> {
  constructor(private readonly projects: ProjectRepository) {
    super();
  }
  protected override get permission(): string | null {
    return "projects.project.read";
  }
  protected override async handle(input: { id: string }): Promise<Record<string, unknown>> {
    // getById primeiro para que a RLS decida antes de qualquer agregacao.
    await this.projects.getById(input.id);
    return ProjectPresenter.summaryToDto(await this.projects.summary(input.id));
  }
}
