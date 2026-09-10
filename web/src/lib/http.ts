import { API_URL, ANON_KEY } from "./config";
import { ApiError, type ApiErrorCode } from "./api-error";

/**
 * A ponte entre o cliente HTTP e o provedor de sessao do React. Existe para o
 * `request()` abaixo nao precisar de hook nenhum: quem monta a sessao registra
 * as quatro funcoes aqui uma vez, no boot.
 */
export interface SessionBridge {
  accessToken(): string | null;
  tenantId(): string | null;
  refresh(): Promise<boolean>;
  logout(): void;
}

let bridge: SessionBridge = {
  accessToken: () => null,
  tenantId: () => null,
  refresh: async () => false,
  logout: () => {},
};

export function connectSession(next: SessionBridge): void {
  bridge = next;
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  params?: QueryParams;
  body?: unknown;
  /**
   * Tres rotas do tenancy sao anteriores a escolha de um tenant e recusam o
   * cabecalho: criar tenant, listar meus tenants e aceitar convite.
   */
  omitTenant?: boolean;
}

/** Parametro vazio e o mesmo que parametro ausente, tal como o backend le. */
function buildUrl(path: string, params?: QueryParams): string {
  const url = new URL(API_URL + path);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: { code: "INTERNAL_ERROR", message: text.slice(0, 300) } };
  }
}

function toApiError(payload: unknown, response: Response): ApiError {
  const requestId = response.headers.get("x-request-id");
  const envelope = (payload ?? {}) as {
    error?: { code?: string; message?: string; details?: Record<string, unknown> };
    requestId?: string;
    msg?: string;
    error_description?: string;
  };
  const inner = envelope.error;

  // O GoTrue nao usa o envelope das Edge Functions; ele responde { msg } ou
  // { error, error_description }. Traduzimos para o mesmo formato.
  if (!inner || typeof inner !== "object") {
    const message = envelope.error_description ?? envelope.msg ??
      (typeof envelope.error === "string" ? envelope.error : null) ??
      `Falha na requisicao (HTTP ${response.status})`;
    return new ApiError({
      code: response.status === 401 || response.status === 400 ? "UNAUTHORIZED" : "INTERNAL_ERROR",
      message,
      status: response.status,
      requestId,
    });
  }

  return new ApiError({
    code: (inner.code as ApiErrorCode) ?? "INTERNAL_ERROR",
    // `GET /iam/roles/:slug` responde 404 sem `message`; nao deixamos vazar "undefined".
    message: inner.message ?? defaultMessage(inner.code, response.status),
    status: response.status,
    details: inner.details,
    requestId: envelope.requestId ?? requestId,
  });
}

function defaultMessage(code: string | undefined, status: number): string {
  switch (code) {
    case "NOT_FOUND":
      return "Recurso nao encontrado";
    case "FORBIDDEN":
      return "Voce nao tem permissao para isso";
    case "UNAUTHORIZED":
      return "Sessao invalida ou expirada";
    default:
      return `Falha na requisicao (HTTP ${status})`;
  }
}

async function send(method: string, path: string, options: RequestOptions): Promise<Response> {
  const headers = new Headers({ apikey: ANON_KEY });
  const token = bridge.accessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  if (!options.omitTenant) {
    const tenantId = bridge.tenantId();
    if (tenantId) headers.set("x-tenant-id", tenantId);
  }

  // O backend ignora corpo em GET e DELETE, entao nem enviamos.
  const hasBody = options.body !== undefined && method !== "GET" && method !== "DELETE";
  if (hasBody) headers.set("Content-Type", "application/json");

  return await fetch(buildUrl(path, options.params), {
    method,
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await send(method, path, options);
  } catch {
    throw new ApiError({
      code: "NETWORK_ERROR",
      message: `Nao consegui falar com a API em ${API_URL}. O stack esta no ar? (make up)`,
      status: 0,
    });
  }

  // Um 401 pode ser apenas o access token de uma hora que venceu. Tentamos o
  // refresh uma vez; se ele nao resolver, a sessao acabou de fato.
  if (response.status === 401 && bridge.accessToken()) {
    const renewed = await bridge.refresh();
    if (renewed) {
      response = await send(method, path, options);
    } else {
      bridge.logout();
    }
  }

  const payload = await parseBody(response);
  if (!response.ok) throw toApiError(payload, response);

  // Toda resposta bem-sucedida das Edge Functions vem embrulhada em `data`.
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export const api = {
  get: <T,>(path: string, params?: QueryParams, omitTenant?: boolean) =>
    request<T>("GET", path, { params, omitTenant }),
  post: <T,>(path: string, body?: unknown, omitTenant?: boolean) =>
    request<T>("POST", path, { body, omitTenant }),
  patch: <T,>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  delete: <T,>(path: string) => request<T>("DELETE", path, {}),
};

/** Prefixo de cada modulo publicado como Edge Function. */
export type ModuleName = "tenancy" | "iam" | "crm" | "projects" | "billing";

export const fn = (module: ModuleName, route: string) => `/functions/v1/${module}${route}`;

/** O envelope de listagem paginada, identico nas onze rotas que paginam. */
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

export const emptyPage = <T,>(): Page<T> => ({
  items: [],
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 0,
  hasNext: false,
});
