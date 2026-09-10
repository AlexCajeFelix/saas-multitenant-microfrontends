import { NotFoundError } from "../domain/errors.ts";
import type { RequestContext } from "../application/context.ts";
import { HttpRequest } from "./http.ts";

export type RouteHandler = (req: HttpRequest, ctx: RequestContext) => Promise<Response>;

/** Uma rota: metodo, padrao com `:parametros` e o handler. */
export class Route {
  private readonly segments: string[];

  constructor(
    readonly method: string,
    readonly pattern: string,
    readonly handler: RouteHandler,
  ) {
    this.segments = Route.split(pattern);
  }

  private static split(path: string): string[] {
    return path.split("/").filter((segment) => segment.length > 0);
  }

  /** Devolve os parametros capturados, ou nulo se a rota nao casa. */
  match(method: string, path: string): Record<string, string> | null {
    if (method !== this.method) return null;
    const parts = Route.split(path);
    if (parts.length !== this.segments.length) return null;

    const params: Record<string, string> = {};
    for (let i = 0; i < this.segments.length; i++) {
      const expected = this.segments[i];
      if (expected.startsWith(":")) {
        params[expected.slice(1)] = decodeURIComponent(parts[i]);
      } else if (expected !== parts[i]) {
        return null;
      }
    }
    return params;
  }
}

/** Tabela de rotas do modulo. Montada uma vez por requisicao pelo EdgeFunction. */
export class Router {
  private readonly routes: Route[] = [];

  register(method: string, pattern: string, handler: RouteHandler): this {
    this.routes.push(new Route(method, pattern, handler));
    return this;
  }

  get(pattern: string, handler: RouteHandler): this {
    return this.register("GET", pattern, handler);
  }
  post(pattern: string, handler: RouteHandler): this {
    return this.register("POST", pattern, handler);
  }
  patch(pattern: string, handler: RouteHandler): this {
    return this.register("PATCH", pattern, handler);
  }
  put(pattern: string, handler: RouteHandler): this {
    return this.register("PUT", pattern, handler);
  }
  delete(pattern: string, handler: RouteHandler): this {
    return this.register("DELETE", pattern, handler);
  }

  mount(controller: Controller): this {
    controller.register(this);
    return this;
  }

  /** Lista legivel das rotas, exposta em GET / de cada modulo. */
  describe(): string[] {
    return this.routes.map((route) => `${route.method} ${route.pattern}`).sort();
  }

  async dispatch(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    for (const route of this.routes) {
      const params = route.match(req.method, req.path);
      if (params) {
        req.params = params;
        return await route.handler(req, ctx);
      }
    }
    throw new NotFoundError(`Rota ${req.method} ${req.path}`);
  }
}

/** Adaptador de entrada: so traduz HTTP em caso de uso e DTO em JSON. */
export abstract class Controller {
  abstract register(router: Router): void;
}
