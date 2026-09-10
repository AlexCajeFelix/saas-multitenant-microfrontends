/**
 * Os DTOs que as Edge Functions devolvem. Nomes em camelCase, datas em ISO-8601,
 * dinheiro sempre em centavos inteiros acompanhado da versao ja formatada.
 * Campos que o backend chama de "date only" chegam como "YYYY-MM-DD".
 */

// ---------------------------------------------------------------- tenancy

export type TenantStatus = "active" | "suspended" | "cancelled";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  settings: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantMembership extends Tenant {
  myRole: string;
  joinedAt: string;
}

export interface Membership {
  id: string;
  tenantId: string;
  userId: string;
  role: string;
  status: "active" | "revoked";
  invitedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface Invitation {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  status: InvitationStatus;
  invitedBy: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  createdAt: string;
}

/** So a resposta da criacao traz o token em claro; depois so o hash fica no banco. */
export interface CreatedInvitation extends Invitation {
  token: string;
}

export interface AcceptedInvitation {
  invitation: Invitation;
  membership: Membership;
}

// -------------------------------------------------------------------- iam

export interface WhoAmI {
  actor: { kind: "user" | "service" | "anonymous"; userId: string | null; email: string | null };
  tenantId: string | null;
  tenantStatus: TenantStatus | null;
  isMember: boolean;
  role: string | null;
  permissions: string[];
  requestId: string;
}

export interface Role {
  id: string;
  tenantId: string | null;
  slug: string;
  name: string;
  description: string;
  isSystem: boolean;
  scope: "system" | "tenant";
  permissions: string[];
  permissionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionCatalog {
  total: number;
  modules: { module: string; permissions: { slug: string; description: string }[] }[];
}

export interface RoleAssignment {
  userId: string;
  role: string;
  previousRole: string | null;
}

export interface ApiKey {
  id: string;
  tenantId: string;
  name: string;
  prefix: string;
  scopes: string[];
  active: boolean;
  createdBy: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** O segredo aparece uma unica vez, na resposta da emissao. */
export interface CreatedApiKey extends ApiKey {
  secret: string;
}

// -------------------------------------------------------------------- crm

export interface Company {
  id: string;
  tenantId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  website: string | null;
  phone: string | null;
  address: Record<string, unknown> | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  tenantId: string;
  companyId: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DealStatus = "open" | "won" | "lost";
export type ActivityKind = "call" | "email" | "meeting" | "note" | "task";

export interface Activity {
  id: string;
  dealId: string;
  kind: ActivityKind;
  subject: string;
  notes: string;
  occurredAt: string;
  createdBy: string | null;
  createdAt: string;
}

export interface Deal {
  id: string;
  tenantId: string;
  title: string;
  companyId: string | null;
  contactId: string | null;
  stageKey: string;
  status: DealStatus;
  amountCents: number;
  currency: string;
  amountFormatted: string;
  probability: number;
  weightedCents: number;
  expectedCloseDate: string | null;
  closedAt: string | null;
  lostReason: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  /** So o detalhe traz as atividades; as linhas da listagem nao. */
  activities?: Activity[];
}

export interface PipelineStage {
  stageKey: string;
  stageName: string;
  position: number;
  dealsCount: number;
  totalCents: number;
  weightedCents: number;
}

export interface Pipeline {
  stages: PipelineStage[];
  totals: { deals: number; totalCents: number; weightedCents: number };
}

// --------------------------------------------------------------- projects

export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "archived";

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  dueDate: string | null;
  position: number;
  completedAt: string | null;
  isCompleted: boolean;
}

export interface Project {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string;
  status: ProjectStatus;
  startDate: string | null;
  dueDate: string | null;
  budgetCents: number;
  currency: string;
  budgetFormatted: string;
  ownerId: string | null;
  clientCompanyId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  milestones?: Milestone[];
}

export interface ProjectSummary {
  projectId: string;
  code: string;
  name: string;
  status: ProjectStatus;
  tasks: Record<string, number>;
  milestones: Record<string, number>;
  loggedMinutes: number;
  estimateMinutes: number;
  budgetCents: number;
  currency: string;
  loggedHours: number;
  estimateHours: number;
}

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface TaskComment {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  projectId: string;
  taskId: string;
  userId: string;
  minutes: number;
  hours: number;
  spentOn: string;
  notes: string;
  createdAt: string;
}

export interface Task {
  id: string;
  tenantId: string;
  projectId: string;
  parentTaskId: string | null;
  milestoneId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  estimateMinutes: number;
  dueDate: string | null;
  completedAt: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  loggedMinutes?: number;
  comments?: TaskComment[];
  timeEntries?: TimeEntry[];
}

// ---------------------------------------------------------------- billing

export interface PlanLimits {
  users: number | null;
  projects: number | null;
  deals: number | null;
  contacts: number | null;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  priceFormatted: string;
  interval: string;
  trialDays: number;
  features: string[];
  limits: PlanLimits;
  isActive: boolean;
  position: number;
}

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled";

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  planCode: string;
  planPriceCents: number;
  currency: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  remainingRatio: number;
  trialEndsAt: string | null;
  isTrialing: boolean;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LimitReport {
  plan: string;
  usage: Record<string, number>;
  limits: Record<string, number | null>;
  violations: { resource: string; limit: number; current: number }[];
  withinLimits: boolean;
}

export interface Proration {
  creditCents: number;
  chargeCents: number;
  differenceCents: number;
  differenceFormatted: string;
  remainingRatio: number;
}

export interface SubscriptionView {
  subscription: Subscription;
  plan: Plan;
  limits: LimitReport;
}

export interface ChangePlanResult extends SubscriptionView {
  proration: Proration;
}

export interface UsageReport {
  periodStart: string;
  periodEnd: string;
  metrics: { metric: string; quantity: number; events: number }[];
}

export interface UsageRecord {
  id: string;
  metric: string;
  quantity: number;
  recordedAt: string;
}

export type InvoiceStatus = "draft" | "open" | "paid" | "void";

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
  totalFormatted: string;
  position: number;
  metadata: Record<string, unknown>;
}

export interface Invoice {
  id: string;
  tenantId: string;
  subscriptionId: string | null;
  number: string;
  status: InvoiceStatus;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  totalFormatted: string;
  periodStart: string;
  periodEnd: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** A listagem nao traz linhas; o detalhe, a criacao, o pagamento e o cancelamento trazem. */
  lines?: InvoiceLine[];
}

/** Retorno das rotas de exclusao logica, iguais nos tres modulos que a tem. */
export interface Deleted {
  deleted: string;
}
