/**
 * Modulo crm — empresas, contatos, funil de vendas e negocios.
 */
import { EdgeFunction, Router } from "../_shared/mod.ts";
import { CrmContainer } from "./container.ts";
import {
  CompanyController,
  ContactController,
  DealController,
} from "./infrastructure/http/controllers.ts";

new EdgeFunction<CrmContainer>({
  module: "crm",
  containerFactory: (ctx, runtime) => CrmContainer.create(ctx, runtime),
  routerFactory: (container) =>
    new Router()
      .mount(new CompanyController(container))
      .mount(new ContactController(container))
      .mount(new DealController(container)),
}).serve();
