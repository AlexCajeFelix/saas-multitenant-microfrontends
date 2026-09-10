/**
 * Modulo billing — planos, assinaturas, consumo medido e faturas.
 */
import { EdgeFunction, Router } from "../_shared/mod.ts";
import { BillingContainer } from "./container.ts";
import { InvoiceController, SubscriptionController } from "./infrastructure/http/controllers.ts";

new EdgeFunction<BillingContainer>({
  module: "billing",
  containerFactory: (ctx, runtime) => BillingContainer.create(ctx, runtime),
  routerFactory: (container) =>
    new Router()
      .mount(new SubscriptionController(container))
      .mount(new InvoiceController(container)),
}).serve();
