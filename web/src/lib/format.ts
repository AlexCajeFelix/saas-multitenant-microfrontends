const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

/** Datas "date only" chegam como "YYYY-MM-DD" e nao podem passar pelo fuso. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const bare = /^\d{4}-\d{2}-\d{2}$/.exec(value);
  if (bare) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : dateOnly.format(parsed);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : dateTime.format(parsed);
}

/**
 * O backend ja manda a versao formatada em pt-BR junto do valor em centavos.
 * Esta funcao existe para os totais que a interface soma sozinha.
 */
export function formatMoney(cents: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function formatHours(minutes: number): string {
  if (!minutes) return "0h";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}min`;
  return rest ? `${hours}h${String(rest).padStart(2, "0")}` : `${hours}h`;
}

/** Converte reais digitados ("1.250,50" ou "1250.5") em centavos inteiros. */
export function parseMoneyToCents(input: string): number {
  const normalized = input.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function initials(value: string): string {
  const clean = value.replace(/@.*$/, "").replace(/[^a-zA-ZÀ-ÿ ]/g, " ").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Um identificador longo encurtado para caber numa tabela sem virar ruido. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  planning: "Planejamento",
  active: "Em andamento",
  on_hold: "Em espera",
  completed: "Concluido",
  archived: "Arquivado",
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  todo: "A fazer",
  in_progress: "Em andamento",
  blocked: "Bloqueada",
  done: "Concluida",
  cancelled: "Cancelada",
};

export const TASK_PRIORITY_LABEL: Record<string, string> = {
  low: "Baixa",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente",
};

export const DEAL_STATUS_LABEL: Record<string, string> = {
  open: "Aberto",
  won: "Ganho",
  lost: "Perdido",
};

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  open: "Em aberto",
  paid: "Paga",
  void: "Anulada",
};

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  trialing: "Em teste",
  active: "Ativa",
  past_due: "Em atraso",
  cancelled: "Cancelada",
};

export const TENANT_STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  suspended: "Suspenso",
  cancelled: "Cancelado",
};

export const INVITATION_STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  accepted: "Aceito",
  revoked: "Revogado",
  expired: "Expirado",
};

export const ACTIVITY_KIND_LABEL: Record<string, string> = {
  call: "Ligacao",
  email: "E-mail",
  meeting: "Reuniao",
  note: "Nota",
  task: "Tarefa",
};

export const ROLE_LABEL: Record<string, string> = {
  owner: "Dono",
  admin: "Administrador",
  manager: "Gerente",
  member: "Membro",
  viewer: "Leitor",
};

export const roleLabel = (slug: string | null) => (slug ? (ROLE_LABEL[slug] ?? slug) : "—");
