import { ValidationError } from "../domain/errors.ts";
import { PageRequest } from "../application/ports.ts";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-tenant-id, x-request-id",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/**
 * Requisicao ja normalizada: caminho sem o prefixo da funcao, corpo lido uma
 * unica vez e parametros de rota preenchidos pelo Router.
 */
export class HttpRequest {
  params: Record<string, string> = {};

  private constructor(
    readonly method: string,
    readonly path: string,
    readonly headers: Headers,
    readonly query: URLSearchParams,
    readonly body: unknown,
    readonly url: URL,
  ) {}

  static async from(request: Request, moduleName: string): Promise<HttpRequest> {
    const url = new URL(request.url);
    const path = HttpRequest.normalizePath(url.pathname, moduleName);

    let body: unknown = null;
    if (!["GET", "HEAD", "OPTIONS", "DELETE"].includes(request.method)) {
      const raw = await request.text();
      if (raw.trim().length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          throw new ValidationError("Corpo da requisicao nao e um JSON valido");
        }
      }
    }

    return new HttpRequest(
      request.method.toUpperCase(),
      path,
      request.headers,
      url.searchParams,
      body,
      url,
    );
  }

  /**
   * O gateway entrega `/<modulo>/<rota>` ao runtime, mas a funcao tambem pode
   * ser chamada direto com o prefixo completo. Aqui os dois viram `/<rota>`.
   */
  private static normalizePath(pathname: string, moduleName: string): string {
    let path = pathname;
    const prefixes = [`/functions/v1/${moduleName}`, `/${moduleName}`];
    for (const prefix of prefixes) {
      if (path === prefix) return "/";
      if (path.startsWith(`${prefix}/`)) {
        path = path.slice(prefix.length);
        break;
      }
    }
    if (!path.startsWith("/")) path = `/${path}`;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return path;
  }

  header(name: string): string | null {
    return this.headers.get(name);
  }

  param(name: string): string {
    const value = this.params[name];
    if (!value) throw new ValidationError(`Parametro de rota ${name} ausente`, { param: name });
    return value;
  }

  queryValue(name: string): string | null {
    const value = this.query.get(name);
    return value === null || value === "" ? null : value;
  }

  queryFlag(name: string): boolean {
    const value = this.queryValue(name);
    return value === "true" || value === "1";
  }

  /** Monta o PageRequest a partir de page, pageSize, sort e order. */
  pageRequest(defaultSort = "created_at"): PageRequest {
    return PageRequest.of(
      Number(this.queryValue("page") ?? 1),
      Number(this.queryValue("pageSize") ?? 25),
      this.queryValue("sort") ?? defaultSort,
      (this.queryValue("order") ?? "desc").toLowerCase() === "asc",
    );
  }

  /** Corpo mesclado aos parametros de rota, que e o que os schemas validam. */
  payload(): Record<string, unknown> {
    const body = (this.body ?? {}) as Record<string, unknown>;
    return { ...body, ...this.params };
  }
}

/** Fabrica de respostas. Toda resposta do sistema sai por aqui. */
export class HttpResponse {
  static json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...CORS_HEADERS,
        ...headers,
      },
    });
  }

  static ok(data: unknown, headers: Record<string, string> = {}): Response {
    return HttpResponse.json({ data }, 200, headers);
  }

  static created(data: unknown, headers: Record<string, string> = {}): Response {
    return HttpResponse.json({ data }, 201, headers);
  }

  static accepted(data: unknown): Response {
    return HttpResponse.json({ data }, 202);
  }

  static noContent(): Response {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  static preflight(): Response {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  static error(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown>,
    requestId: string,
  ): Response {
    return HttpResponse.json({ error: { code, message, details }, requestId }, status);
  }
}
