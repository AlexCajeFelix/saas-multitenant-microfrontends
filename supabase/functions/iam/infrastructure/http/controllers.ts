import {
  Controller,
  type HttpRequest,
  HttpResponse,
  type RequestContext,
  type Router,
} from "../../../_shared/mod.ts";
import type { IamContainer } from "../../container.ts";
import {
  ApiKeyIdSchema,
  AssignRoleSchema,
  CreateRoleSchema,
  IssueApiKeySchema,
  RolePermissionsSchema,
  RoleSlugSchema,
  UpdateRoleSchema,
} from "../../application/dto.ts";

export class RoleController extends Controller {
  constructor(private readonly container: IamContainer) {
    super();
  }

  override register(router: Router): void {
    router.get("/permissions", (_req, ctx) => this.listPermissions(ctx));
    router.get("/whoami", (_req, ctx) => this.whoAmI(ctx));
    router.get("/roles", (_req, ctx) => this.list(ctx));
    router.post("/roles", (req, ctx) => this.create(req, ctx));
    router.get("/roles/:slug", (req, ctx) => this.get(req, ctx));
    router.patch("/roles/:slug", (req, ctx) => this.update(req, ctx));
    router.delete("/roles/:slug", (req, ctx) => this.remove(req, ctx));
    router.post("/roles/:slug/permissions", (req, ctx) => this.grant(req, ctx));
    router.delete("/roles/:slug/permissions", (req, ctx) => this.revoke(req, ctx));
    router.post("/assignments", (req, ctx) => this.assign(req, ctx));
  }

  private async listPermissions(ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(await this.container.listPermissions.execute(undefined, ctx));
  }

  private async whoAmI(ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(await this.container.whoAmI.execute(undefined, ctx));
  }

  private async list(ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(await this.container.listRoles.execute(undefined, ctx));
  }

  private async create(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.created(
      await this.container.createRole.execute(CreateRoleSchema.parse(req.body), ctx),
    );
  }

  private async get(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const { slug } = RoleSlugSchema.parse(req.payload());
    const roles = await this.container.listRoles.execute(undefined, ctx);
    const found = roles.find((role) => role.slug === slug);
    if (!found) return HttpResponse.json({ error: { code: "NOT_FOUND" } }, 404);
    return HttpResponse.ok(found);
  }

  private async update(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.updateRole.execute(UpdateRoleSchema.parse(req.payload()), ctx),
    );
  }

  private async remove(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.deleteRole.execute(RoleSlugSchema.parse(req.payload()), ctx),
    );
  }

  private async grant(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const input = RolePermissionsSchema.parse(req.payload());
    return HttpResponse.ok(await this.container.grantPermissions.execute(input, ctx));
  }

  private async revoke(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const input = RolePermissionsSchema.parse(req.payload());
    return HttpResponse.ok(await this.container.revokePermissions.execute(input, ctx));
  }

  private async assign(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.assignRole.execute(AssignRoleSchema.parse(req.body), ctx),
    );
  }
}

export class ApiKeyController extends Controller {
  constructor(private readonly container: IamContainer) {
    super();
  }

  override register(router: Router): void {
    router.post("/api-keys", (req, ctx) => this.issue(req, ctx));
    router.get("/api-keys", (req, ctx) => this.list(req, ctx));
    router.delete("/api-keys/:id", (req, ctx) => this.revoke(req, ctx));
  }

  private async issue(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.created(
      await this.container.issueApiKey.execute(IssueApiKeySchema.parse(req.body), ctx),
    );
  }

  private async list(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(await this.container.listApiKeys.execute(req.pageRequest(), ctx));
  }

  private async revoke(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.revokeApiKey.execute(ApiKeyIdSchema.parse(req.payload()), ctx),
    );
  }
}
