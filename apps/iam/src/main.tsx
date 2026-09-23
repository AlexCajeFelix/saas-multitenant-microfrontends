import { Route } from "react-router-dom";
import { mountZone } from "@saas/platform/zone";
import { NotFound } from "@saas/platform/components/NotFound";
import { Roles } from "./routes/Roles";
import { RoleDetail } from "./routes/RoleDetail";
import { Permissions } from "./routes/Permissions";
import { ApiKeys } from "./routes/ApiKeys";

mountZone({
  zone: "iam",
  routes: (
    <>
      <Route path="iam/papeis" element={<Roles />} />
      <Route path="iam/papeis/:slug" element={<RoleDetail />} />
      <Route path="iam/permissoes" element={<Permissions />} />
      <Route path="iam/chaves" element={<ApiKeys />} />
      <Route path="*" element={<NotFound />} />
    </>
  ),
});
