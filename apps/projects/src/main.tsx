import { Route } from "react-router-dom";
import { mountZone } from "@saas/platform/zone";
import { NotFound } from "@saas/platform/components/NotFound";
import { Projects } from "./routes/Projects";
import { ProjectDetail } from "./routes/ProjectDetail";
import { Tasks } from "./routes/Tasks";
import { TaskDetail } from "./routes/TaskDetail";

mountZone({
  zone: "projects",
  routes: (
    <>
      <Route path="projetos" element={<Projects />} />
      <Route path="projetos/:id" element={<ProjectDetail />} />
      <Route path="tarefas" element={<Tasks />} />
      <Route path="tarefas/:id" element={<TaskDetail />} />
      <Route path="*" element={<NotFound />} />
    </>
  ),
});
