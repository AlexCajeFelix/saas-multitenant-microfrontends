import {
  Controller,
  HttpResponse,
  type HttpRequest,
  type RequestContext,
  type Router,
} from "../../../_shared/mod.ts";
import type { BillingContainer } from "../../container.ts";
import {
  CancelSubscriptionSchema,
  ChangePlanSchema,
  IdSchema,
  IssueInvoiceSchema,
  RecordUsageSchema,
  SubscribeSchema,
} from "../../application/dto.ts";

export class SubscriptionController extends Controller {
  constructor(private readonly container: BillingContainer) {
    super();
  }

  override register(router: Router): void {
    router.get("/plans", (_req, ctx) => this.listPlans(ctx));
    router.post("/subscriptions", (req, ctx) => this.subscribe(req, ctx));
    router.get("/subscriptions/current", (_req, ctx) => this.current(ctx));
    router.post("/subscriptions/change-plan", (req, ctx) => this.changePlan(req, ctx));
    router.post("/subscriptions/cancel", (req, ctx) => this.cancel(req, ctx));
    router.post("/usage", (req, ctx) => this.recordUsage(req, ctx));
    router.get("/usage", (_req, ctx) => this.usage(ctx));
  }

  private async listPlans(ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(await this.container.listPlans.execute(undefined, ctx));
  }

  private async subscribe(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.created(
      await this.container.subscribe.execute(SubscribeSchema.parse(req.body), ctx),
    );
  }

  private async current(ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(await this.container.currentSubscription.execute(undefined, ctx));
  }

  private async changePlan(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.changePlan.execute(ChangePlanSchema.parse(req.body), ctx),
    );
  }

  private async cancel(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.cancelSubscription.execute(
        CancelSubscriptionSchema.parse(req.body),
        ctx,
      ),
    );
  }

  private async recordUsage(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.created(
      await this.container.recordUsage.execute(RecordUsageSchema.parse(req.body), ctx),
    );
  }

  private async usage(ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(await this.container.getUsage.execute(undefined, ctx));
  }
}

export class InvoiceController extends Controller {
  constructor(private readonly container: BillingContainer) {
    super();
  }

  override register(router: Router): void {
    router.post("/invoices", (req, ctx) => this.issue(req, ctx));
    router.get("/invoices", (req, ctx) => this.list(req, ctx));
    router.get("/invoices/:id", (req, ctx) => this.get(req, ctx));
    router.post("/invoices/:id/pay", (req, ctx) => this.pay(req, ctx));
    router.post("/invoices/:id/void", (req, ctx) => this.voidInvoice(req, ctx));
  }

  private async issue(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.created(
      await this.container.issueInvoice.execute(IssueInvoiceSchema.parse(req.body), ctx),
    );
  }

  private async list(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    const filter = {
      status: req.queryValue("status") ?? undefined,
      subscriptionId: req.queryValue("subscriptionId") ?? undefined,
    };
    return HttpResponse.ok(
      await this.container.listInvoices.execute({ filter, page: req.pageRequest() }, ctx),
    );
  }

  private async get(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.getInvoice.execute(IdSchema.parse(req.payload()), ctx),
    );
  }

  private async pay(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.payInvoice.execute(IdSchema.parse(req.payload()), ctx),
    );
  }

  private async voidInvoice(req: HttpRequest, ctx: RequestContext): Promise<Response> {
    return HttpResponse.ok(
      await this.container.voidInvoice.execute(IdSchema.parse(req.payload()), ctx),
    );
  }
}
