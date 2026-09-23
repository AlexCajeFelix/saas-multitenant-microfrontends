import {
  Controller,
  type HttpRequest,
  HttpResponse,
  type RequestContext,
  type Router,
} from "../../../_shared/mod.ts";
import type { TenancyContainer } from "../../container.ts";
import {
  AcceptInvitationSchema,
  ChangeMemberRoleSchema,
  CreateTenantSchema,
  InvitationIdSchema,
  InviteMemberSchema,
  MemberIdSchema,
  TenantStatusChangeSchema,
  UpdateTenantSchema,
} from "../../application/dto.ts";

/** Adaptador de entrada: valida, delega ao caso de uso e serializa. */
export class TenantController extends Controller {
  constructor(private readonly container: TenancyContainer) {
    super();
  }

  override register(router: Router): void {
    router.post("/tenants", (req, ctx) => this.create(req, ctx));
    router.get("/tenants", (_req, ctx) => this.listMine(ctx));
    router.get("/tenants/:id", (req, ctx) => this.get(req, ctx));
    router.patch("/tenants/:id", (req, ctx) => this.update(req, ctx));
    router.post("/tenants/:id/suspend", (req, ctx) => this.suspend(req, ctx));
    router.post("/tenants/:id/activate", (req, ctx) => this.activate(req, ctx));
  }

  private async create(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const input = CreateTenantSchema.parse(req.body);
    return HttpResponse.created(await this.container.createTenant.execute(input, ctx));
  }

  private async listMine(ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(await this.container.listMyTenants.execute(undefined, ctx));
  }

  private async get(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.getTenant.execute({ id: req.param("id") }, ctx),
    );
  }

  private async update(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const input = UpdateTenantSchema.parse(req.payload());
    return HttpResponse.ok(await this.container.updateTenant.execute(input, ctx));
  }

  private async suspend(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const input = TenantStatusChangeSchema.parse(req.payload());
    return HttpResponse.ok(await this.container.suspendTenant.execute(input, ctx));
  }

  private async activate(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const input = TenantStatusChangeSchema.parse(req.payload());
    return HttpResponse.ok(await this.container.activateTenant.execute(input, ctx));
  }
}

export class MemberController extends Controller {
  constructor(private readonly container: TenancyContainer) {
    super();
  }

  override register(router: Router): void {
    router.get("/members", (req, ctx) => this.list(req, ctx));
    router.patch("/members/:userId", (req, ctx) => this.changeRole(req, ctx));
    router.delete("/members/:userId", (req, ctx) => this.remove(req, ctx));
  }

  private async list(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(await this.container.listMembers.execute(req.pageRequest(), ctx));
  }

  private async changeRole(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const input = ChangeMemberRoleSchema.parse(req.payload());
    return HttpResponse.ok(await this.container.changeMemberRole.execute(input, ctx));
  }

  private async remove(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const input = MemberIdSchema.parse(req.payload());
    return HttpResponse.ok(await this.container.removeMember.execute(input, ctx));
  }
}

export class InvitationController extends Controller {
  constructor(private readonly container: TenancyContainer) {
    super();
  }

  override register(router: Router): void {
    router.post("/invitations", (req, ctx) => this.invite(req, ctx));
    router.get("/invitations", (req, ctx) => this.list(req, ctx));
    router.post("/invitations/accept", (req, ctx) => this.accept(req, ctx));
    router.delete("/invitations/:invitationId", (req, ctx) => this.revoke(req, ctx));
  }

  private async invite(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const input = InviteMemberSchema.parse(req.body);
    return HttpResponse.created(await this.container.inviteMember.execute(input, ctx));
  }

  private async list(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(await this.container.listInvitations.execute(req.pageRequest(), ctx));
  }

  private async accept(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const input = AcceptInvitationSchema.parse(req.body);
    return HttpResponse.ok(await this.container.acceptInvitation.execute(input, ctx));
  }

  private async revoke(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const input = InvitationIdSchema.parse(req.payload());
    return HttpResponse.ok(await this.container.revokeInvitation.execute(input, ctx));
  }
}
