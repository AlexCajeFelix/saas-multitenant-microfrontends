/**
 * Modulo iam — papeis, permissoes, atribuicoes e chaves de API.
 */
import { EdgeFunction, Router } from "../_shared/mod.ts";
import { IamContainer } from "./container.ts";
import { ApiKeyController, RoleController } from "./infrastructure/http/controllers.ts";

new EdgeFunction<IamContainer>({
  module: "iam",
  containerFactory: (ctx, runtime) => IamContainer.create(ctx, runtime),
  routerFactory: (container) =>
    new Router()
      .mount(new RoleController(container))
      .mount(new ApiKeyController(container)),
}).serve();
