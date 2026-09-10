import { DomainError, InfrastructureError, UnauthorizedError } from "../domain/errors.ts";
import { Actor, RequestContext } from "../application/context.ts";
import type { Clock, IdGenerator, Logger, SecretHasher } from "../application/ports.ts";
import { SupabaseConnection } from "../infrastructure/supabase.ts";
import {
  ConsoleLogger,
  CryptoIdGenerator,
  Sha256SecretHasher,
  SystemClock,
} from "../infrastructure/services.ts";
import { CORS_HEADERS, HttpRequest, HttpResponse } from "./http.ts";
import type { Router } from "./router.ts";

export interface JwtClaims {
  sub?: string;
  email?: string;
  role?: string;
  exp?: number;
  tenant_id?: string;
  app_metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Verificacao de JWT HS256 com Web Crypto.
 *
 * O runtime das Edge Functions roda com VERIFY_JWT desligado, porque a
 * autorizacao e nossa. Se confiassemos no token sem conferir a assinatura,
 * qualquer um poderia se declarar dono de um tenant nas operacoes que usam a
 * chave de servico. Por isso a assinatura e conferida aqui, com o mesmo
 * segredo que o GoTrue usa para assinar.
 */
export class JwtVerifier {
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(private readonly secret: string) {}

  static fromEnv(): JwtVerifier {
    const secret = Deno.env.get("JWT_SECRET");
    if (!secret) throw new InfrastructureError("JWT_SECRET nao configurado");
    return new JwtVerifier(secret);
  }

  private key(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      this.keyPromise = crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(this.secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
    }
    return this.keyPromise;
  }

  private static decodeSegment(segment: string): Record<string, unknown> {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
    const binary = atob(withPadding);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async verify(token: string): Promise<JwtClaims> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new UnauthorizedError("Token malformado");

    const [headerPart, payloadPart, signaturePart] = parts;
    let header: Record<string, unknown>;
    let payload: JwtClaims;
    try {
      header = JwtVerifier.decodeSegment(headerPart);
      payload = JwtVerifier.decodeSegment(payloadPart) as JwtClaims;
    } catch {
      throw new UnauthorizedError("Token ilegivel");
    }

    if (header.alg !== "HS256") {
      throw new UnauthorizedError(`Algoritmo de token nao suportado: ${String(header.alg)}`);
    }

    const normalized = signaturePart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const signature = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));

    const valid = await crypto.subtle.verify(
      "HMAC",
      await this.key(),
      signature,
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
    if (!valid) throw new UnauthorizedError("Assinatura do token invalida");

    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
      throw new UnauthorizedError("Token expirado");
    }
    return payload;
  }
}

/**
 * Dependencias vivas enquanto o worker existe. Sao caras de criar e nao tem
 * estado por requisicao, entao ficam no runtime e nao no container do modulo.
 */
export class ModuleRuntime {
  readonly connection: SupabaseConnection;
  readonly verifier: JwtVerifier;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly hasher: SecretHasher;

  constructor(readonly module: string) {
    this.connection = SupabaseConnection.fromEnv();
    this.verifier = JwtVerifier.fromEnv();
    this.logger = new ConsoleLogger({ module });
    this.clock = new SystemClock();
    this.ids = new CryptoIdGenerator();
    this.hasher = new Sha256SecretHasher();
  }
}

/**
 * Resolve identidade, tenant e permissoes efetivas em uma unica ida ao banco,
 * pela funcao core.access_context.
 */
export class ContextFactory {
  constructor(
    private readonly runtime: ModuleRuntime,
    private readonly module: string,
  ) {}

  private static bearer(request: Request): string | null {
    const header = request.headers.get("Authorization") ?? request.headers.get("authorization");
    if (header && header.toLowerCase().startsWith("bearer ")) {
      return header.slice(7).trim();
    }
    return request.headers.get("apikey");
  }

  private static tenantFrom(request: Request, claims: JwtClaims): string | null {
    const url = new URL(request.url);
    const raw = request.headers.get("x-tenant-id") ??
      url.searchParams.get("tenant_id") ??
      (claims.tenant_id as string | undefined) ??
      ((claims.app_metadata as Record<string, unknown> | undefined)?.tenant_id as
        | string
        | undefined);
    return raw && raw.trim().length > 0 ? raw.trim() : null;
  }

  async create(request: Request, requestId: string): Promise<RequestContext> {
    const token = ContextFactory.bearer(request);

    if (!token) {
      return new RequestContext({
        requestId,
        actor: Actor.anonymous(),
        tenantId: null,
        tenantStatus: null,
        isMember: false,
        role: null,
        permissions: [],
        accessToken: null,
        module: this.module,
      });
    }

    const claims = await this.runtime.verifier.verify(token);
    const isService = claims.role === "service_role";
    const actor = isService
      ? Actor.service()
      : claims.sub
      ? Actor.user(claims.sub, (claims.email as string | undefined) ?? null)
      : Actor.anonymous();

    const tenantId = ContextFactory.tenantFrom(request, claims);

    let permissions: string[] = [];
    let isMember = false;
    let role: string | null = null;
    let tenantStatus: string | null = null;

    if (tenantId && actor.userId) {
      const { data, error } = await this.runtime.connection
        .asService("core")
        .rpc("access_context", { p_tenant: tenantId, p_user: actor.userId });
      if (error) {
        throw new InfrastructureError(`Falha ao resolver o contexto de acesso: ${error.message}`);
      }
      const context = (data ?? {}) as Record<string, unknown>;
      isMember = context.is_member === true;
      role = (context.role as string | null) ?? null;
      tenantStatus = (context.tenant_status as string | null) ?? null;
      permissions = (context.permissions as string[] | null) ?? [];
    } else if (tenantId && isService) {
      const { data } = await this.runtime.connection
        .asService("core")
        .from("tenants")
        .select("status")
        .eq("id", tenantId)
        .maybeSingle();
      tenantStatus = (data?.status as string | undefined) ?? null;
      isMember = true;
    }

    return new RequestContext({
      requestId,
      actor,
      tenantId,
      tenantStatus,
      isMember,
      role,
      permissions,
      accessToken: token,
      module: this.module,
    });
  }
}

/** Converte qualquer excecao na resposta de erro do contrato da API. */
export class ErrorPresenter {
  constructor(private readonly logger: Logger) {}

  present(error: unknown, requestId: string): Response {
    if (error instanceof DomainError) {
      if (error.status >= 500) {
        this.logger.error(error.message, { requestId, code: error.code, ...error.details });
      } else {
        this.logger.info(`recusado: ${error.message}`, { requestId, code: error.code });
      }
      return HttpResponse.error(
        error.status,
        error.code,
        error.message,
        error.details,
        requestId,
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    this.logger.error("erro nao tratado", {
      requestId,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return HttpResponse.error(500, "INTERNAL_ERROR", "Erro interno", {}, requestId);
  }
}

export interface EdgeFunctionConfig<TContainer> {
  module: string;
  /** Raiz de composicao: monta o grafo de dependencias desta requisicao. */
  containerFactory: (ctx: RequestContext, runtime: ModuleRuntime) => TContainer;
  /** Tabela de rotas do modulo, ligada ao container recem-montado. */
  routerFactory: (container: TContainer) => Router;
}

/**
 * O adaptador primario. Recebe a requisicao HTTP, monta o contexto, monta o
 * container do modulo, despacha para a rota e traduz o que voltar. E o unico
 * ponto do sistema que conhece Deno.serve.
 */
export class EdgeFunction<TContainer> {
  private readonly runtime: ModuleRuntime;
  private readonly contexts: ContextFactory;
  private readonly presenter: ErrorPresenter;

  constructor(private readonly config: EdgeFunctionConfig<TContainer>) {
    this.runtime = new ModuleRuntime(config.module);
    this.contexts = new ContextFactory(this.runtime, config.module);
    this.presenter = new ErrorPresenter(this.runtime.logger);
  }

  serve(): void {
    Deno.serve((request) => this.handle(request));
  }

  async handle(request: Request): Promise<Response> {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const startedAt = performance.now();

    if (request.method === "OPTIONS") {
      return HttpResponse.preflight();
    }

    let response: Response;
    let path = new URL(request.url).pathname;

    try {
      const httpRequest = await HttpRequest.from(request, this.config.module);
      path = httpRequest.path;

      if (httpRequest.method === "GET" && httpRequest.path === "/health") {
        return this.withRequestId(
          HttpResponse.ok({ module: this.config.module, status: "ok" }),
          requestId,
        );
      }

      const ctx = await this.contexts.create(request, requestId);
      const container = this.config.containerFactory(ctx, this.runtime);
      const router = this.config.routerFactory(container);
      router.get(
        "/",
        () =>
          Promise.resolve(
            HttpResponse.ok({ module: this.config.module, routes: router.describe() }),
          ),
      );

      response = await router.dispatch(httpRequest, ctx);
    } catch (error) {
      response = this.presenter.present(error, requestId);
    }

    this.runtime.logger.info("requisicao", {
      requestId,
      method: request.method,
      path,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return this.withRequestId(response, requestId);
  }

  private withRequestId(response: Response, requestId: string): Response {
    const headers = new Headers(response.headers);
    headers.set("x-request-id", requestId);
    for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
