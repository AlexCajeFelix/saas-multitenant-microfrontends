import { Route } from "react-router-dom";
import { mountZone } from "@saas/platform/zone";
import { NotFound } from "@saas/platform/components/NotFound";
import { Members } from "./routes/Members";
import { Invitations } from "./routes/Invitations";
import { TenantSettings } from "./routes/TenantSettings";

mountZone({
  zone: "tenancy",
  routes: (
    <>
      <Route path="tenancy/membros" element={<Members />} />
      <Route path="tenancy/convites" element={<Invitations />} />
      <Route path="tenancy/ajustes" element={<TenantSettings />} />
      <Route path="*" element={<NotFound />} />
    </>
  ),
});
