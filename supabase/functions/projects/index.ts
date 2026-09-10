/**
 * Modulo projects — projetos, marcos, tarefas, comentarios e horas.
 */
import { EdgeFunction, Router } from "../_shared/mod.ts";
import { ProjectsContainer } from "./container.ts";
import { ProjectController, TaskController } from "./infrastructure/http/controllers.ts";

new EdgeFunction<ProjectsContainer>({
  module: "projects",
  containerFactory: (ctx, runtime) => ProjectsContainer.create(ctx, runtime),
  routerFactory: (container) =>
    new Router()
      .mount(new ProjectController(container))
      .mount(new TaskController(container)),
}).serve();
