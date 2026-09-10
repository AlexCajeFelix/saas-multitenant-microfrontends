import { api, fn, type Page } from "../lib/http";
import type { ListParams } from "./params";
import type {
  Milestone,
  Project,
  ProjectStatus,
  ProjectSummary,
  Task,
  TaskComment,
  TaskPriority,
  TaskStatus,
  TimeEntry,
} from "./types";

// O modulo se chama projects e o recurso tambem, dai o caminho duplicado.
const path = (route: string) => fn("projects", route);

export interface ProjectInput {
  name: string;
  code?: string;
  description?: string;
  startDate?: string;
  dueDate?: string;
  budgetCents?: number;
  currency?: string;
  ownerId?: string;
  clientCompanyId?: string;
}

export interface TaskInput {
  projectId: string;
  title: string;
  description?: string;
  parentTaskId?: string;
  milestoneId?: string;
  priority?: TaskPriority;
  assigneeId?: string;
  estimateMinutes?: number;
  dueDate?: string;
}

export const projectsApi = {
  listProjects: (params: ListParams & { status?: ProjectStatus; search?: string } = {}) =>
    api.get<Page<Project>>(path("/projects"), { ...params }),
  getProject: (id: string) => api.get<Project>(path(`/projects/${id}`)),
  createProject: (body: ProjectInput) => api.post<Project>(path("/projects"), body),
  updateProject: (id: string, body: Partial<Omit<ProjectInput, "code">>) =>
    api.patch<Project>(path(`/projects/${id}`), body),
  projectSummary: (id: string) => api.get<ProjectSummary>(path(`/projects/${id}/summary`)),
  changeProjectStatus: (id: string, status: ProjectStatus) =>
    api.post<Project>(path(`/projects/${id}/status`), { status }),
  archiveProject: (id: string) => api.post<Project>(path(`/projects/${id}/archive`)),
  addMilestone: (projectId: string, body: { name: string; dueDate?: string }) =>
    api.post<Milestone>(path(`/projects/${projectId}/milestones`), body),

  listTasks: (
    params: ListParams & {
      projectId?: string;
      status?: TaskStatus;
      assigneeId?: string;
      parentTaskId?: string;
      search?: string;
    } = {},
  ) => api.get<Page<Task>>(path("/tasks"), { ...params }),
  getTask: (id: string) => api.get<Task>(path(`/tasks/${id}`)),
  createTask: (body: TaskInput) => api.post<Task>(path("/tasks"), body),
  updateTask: (
    id: string,
    body: Partial<Pick<TaskInput, "title" | "description" | "priority" | "estimateMinutes" | "dueDate" | "milestoneId">>,
  ) => api.patch<Task>(path(`/tasks/${id}`), body),

  /** Sem `assigneeId` a tarefa fica sem responsavel. */
  assignTask: (id: string, assigneeId?: string) =>
    api.post<Task>(path(`/tasks/${id}/assign`), assigneeId ? { assigneeId } : {}),
  changeTaskStatus: (id: string, status: TaskStatus) =>
    api.post<Task>(path(`/tasks/${id}/status`), { status }),
  commentTask: (id: string, body: string) =>
    api.post<TaskComment>(path(`/tasks/${id}/comments`), { body }),
  logTime: (id: string, entry: { minutes: number; spentOn?: string; notes?: string }) =>
    api.post<TimeEntry>(path(`/tasks/${id}/time-entries`), entry),
};
