import { Route } from "react-router-dom";
import { mountZone } from "@saas/platform/zone";
import { NotFound } from "@saas/platform/components/NotFound";
import { Login } from "./routes/Login";
import { AcceptInvite } from "./routes/AcceptInvite";
import { Tenants } from "./routes/Tenants";
import { Overview } from "./routes/Overview";

mountZone({
  zone: "shell",
  publicRoutes: (
    <>
      <Route path="/login" element={<Login />} />
    </>
  ),
  sessionRoutes: (
    <>
      <Route path="/convite" element={<AcceptInvite />} />
      <Route path="/tenants" element={<Tenants />} />
    </>
  ),
  routes: (
    <>
      <Route index element={<Overview />} />
      <Route path="*" element={<NotFound />} />
    </>
  ),
});
