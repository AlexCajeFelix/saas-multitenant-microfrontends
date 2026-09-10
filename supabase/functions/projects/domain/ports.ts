import type { Page, PageRequest } from "../../_shared/mod.ts";
import type { Project, Task } from "./entities.ts";

export interface ProjectFilter {
  status?: string;
  ownerId?: string;
  search?: string;
}

export interface TaskFilter {
  projectId?: string;
  status?: string;
  assigneeId?: string;
  parentTaskId?: string;
  search?: string;
}

export interface ProjectSummary {
  projectId: string;
  code: string;
  name: string;
  status: string;
  tasks: Record<string, number>;
  milestones: Record<string, number>;
  loggedMinutes: number;
  estimateMinutes: number;
  budgetCents: number;
  currency: string;
}

export interface ProjectRepository {
  getById(id: string, withMilestones?: boolean): Promise<Project>;
  findByCode(code: string): Promise<Project | null>;
  search(filter: ProjectFilter, page: PageRequest): Promise<Page<Project>>;
  insert(project: Project): Promise<Project>;
  save(project: Project): Promise<Project>;
  summary(projectId: string): Promise<ProjectSummary>;
}

export interface TaskRepository {
  getById(id: string, withChildren?: boolean): Promise<Task>;
  search(filter: TaskFilter, page: PageRequest): Promise<Page<Task>>;
  countOpenSubtasks(parentTaskId: string): Promise<number>;
  insert(task: Task): Promise<Task>;
  save(task: Task): Promise<Task>;
}
