/**
 * Modulo tenancy — tenants, membros e convites.
 *
 * Ponto de entrada da Edge Function: liga o adaptador HTTP ao container do
 * modulo. Nenhuma regra de negocio mora aqui.
 */
import { EdgeFunction, Router } from "../_shared/mod.ts";
import { TenancyContainer } from "./container.ts";
import {
  InvitationController,
  MemberController,
  TenantController,
} from "./infrastructure/http/controllers.ts";

new EdgeFunction<TenancyContainer>({
  module: "tenancy",
  containerFactory: (ctx, runtime) => TenancyContainer.create(ctx, runtime),
  routerFactory: (container) =>
    new Router()
      .mount(new TenantController(container))
      .mount(new MemberController(container))
      .mount(new InvitationController(container)),
}).serve();
