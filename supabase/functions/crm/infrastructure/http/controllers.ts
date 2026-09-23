import {
  Controller,
  type HttpRequest,
  HttpResponse,
  type RequestContext,
  type Router,
} from "../../../_shared/mod.ts";
import type { CrmContainer } from "../../container.ts";
import {
  CreateCompanySchema,
  CreateContactSchema,
  CreateDealSchema,
  IdSchema,
  LogActivitySchema,
  LoseDealSchema,
  MoveDealSchema,
  UpdateCompanySchema,
  UpdateContactSchema,
  UpdateDealSchema,
  WinDealSchema,
} from "../../application/dto.ts";

export class CompanyController extends Controller {
  constructor(private readonly container: CrmContainer) {
    super();
  }

  override register(router: Router): void {
    router.post("/companies", (req, ctx) => this.create(req, ctx));
    router.get("/companies", (req, ctx) => this.list(req, ctx));
    router.get("/companies/:id", (req, ctx) => this.get(req, ctx));
    router.patch("/companies/:id", (req, ctx) => this.update(req, ctx));
    router.delete("/companies/:id", (req, ctx) => this.remove(req, ctx));
  }

  private async create(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.created(
      await this.container.createCompany.execute(CreateCompanySchema.parse(req.body), ctx),
    );
  }

  private async list(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const filter = {
      search: req.queryValue("search") ?? undefined,
      ownerId: req.queryValue("ownerId") ?? undefined,
    };
    return HttpResponse.ok(
      await this.container.listCompanies.execute({ filter, page: req.pageRequest() }, ctx),
    );
  }

  private async get(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.getCompany.execute(IdSchema.parse(req.payload()), ctx),
    );
  }

  private async update(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.updateCompany.execute(UpdateCompanySchema.parse(req.payload()), ctx),
    );
  }

  private async remove(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.deleteCompany.execute(IdSchema.parse(req.payload()), ctx),
    );
  }
}

export class ContactController extends Controller {
  constructor(private readonly container: CrmContainer) {
    super();
  }

  override register(router: Router): void {
    router.post("/contacts", (req, ctx) => this.create(req, ctx));
    router.get("/contacts", (req, ctx) => this.list(req, ctx));
    router.get("/contacts/:id", (req, ctx) => this.get(req, ctx));
    router.patch("/contacts/:id", (req, ctx) => this.update(req, ctx));
    router.delete("/contacts/:id", (req, ctx) => this.remove(req, ctx));
  }

  private async create(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.created(
      await this.container.createContact.execute(CreateContactSchema.parse(req.body), ctx),
    );
  }

  private async list(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const filter = {
      search: req.queryValue("search") ?? undefined,
      companyId: req.queryValue("companyId") ?? undefined,
      ownerId: req.queryValue("ownerId") ?? undefined,
    };
    return HttpResponse.ok(
      await this.container.listContacts.execute({ filter, page: req.pageRequest() }, ctx),
    );
  }

  private async get(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.getContact.execute(IdSchema.parse(req.payload()), ctx),
    );
  }

  private async update(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.updateContact.execute(UpdateContactSchema.parse(req.payload()), ctx),
    );
  }

  private async remove(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.deleteContact.execute(IdSchema.parse(req.payload()), ctx),
    );
  }
}

export class DealController extends Controller {
  constructor(private readonly container: CrmContainer) {
    super();
  }

  override register(router: Router): void {
    router.get("/pipeline", (_req, ctx) => this.pipeline(ctx));
    router.post("/deals", (req, ctx) => this.create(req, ctx));
    router.get("/deals", (req, ctx) => this.list(req, ctx));
    router.get("/deals/:id", (req, ctx) => this.get(req, ctx));
    router.patch("/deals/:id", (req, ctx) => this.update(req, ctx));
    router.post("/deals/:id/stage", (req, ctx) => this.move(req, ctx));
    router.post("/deals/:id/win", (req, ctx) => this.win(req, ctx));
    router.post("/deals/:id/lose", (req, ctx) => this.lose(req, ctx));
    router.post("/deals/:id/activities", (req, ctx) => this.logActivity(req, ctx));
  }

  private async pipeline(ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(await this.container.getPipeline.execute(undefined, ctx));
  }

  private async create(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.created(
      await this.container.createDeal.execute(CreateDealSchema.parse(req.body), ctx),
    );
  }

  private async list(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const filter = {
      status: req.queryValue("status") ?? undefined,
      stageKey: req.queryValue("stageKey") ?? undefined,
      companyId: req.queryValue("companyId") ?? undefined,
      ownerId: req.queryValue("ownerId") ?? undefined,
      search: req.queryValue("search") ?? undefined,
    };
    return HttpResponse.ok(
      await this.container.listDeals.execute({ filter, page: req.pageRequest() }, ctx),
    );
  }

  private async get(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.getDeal.execute(IdSchema.parse(req.payload()), ctx),
    );
  }

  private async update(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.updateDeal.execute(UpdateDealSchema.parse(req.payload()), ctx),
    );
  }

  private async move(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.moveDeal.execute(MoveDealSchema.parse(req.payload()), ctx),
    );
  }

  private async win(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.winDeal.execute(WinDealSchema.parse(req.payload()), ctx),
    );
  }

  private async lose(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.loseDeal.execute(LoseDealSchema.parse(req.payload()), ctx),
    );
  }

  private async logActivity(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.created(
      await this.container.logActivity.execute(LogActivitySchema.parse(req.payload()), ctx),
    );
  }
}
