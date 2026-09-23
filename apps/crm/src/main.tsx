import { Route } from "react-router-dom";
import { mountZone } from "@saas/platform/zone";
import { NotFound } from "@saas/platform/components/NotFound";
import { PipelineBoard } from "./routes/PipelineBoard";
import { Deals } from "./routes/Deals";
import { DealDetail } from "./routes/DealDetail";
import { Companies } from "./routes/Companies";
import { Contacts } from "./routes/Contacts";

mountZone({
  zone: "crm",
  routes: (
    <>
      <Route path="crm/funil" element={<PipelineBoard />} />
      <Route path="crm/negocios" element={<Deals />} />
      <Route path="crm/negocios/:id" element={<DealDetail />} />
      <Route path="crm/empresas" element={<Companies />} />
      <Route path="crm/contatos" element={<Contacts />} />
      <Route path="*" element={<NotFound />} />
    </>
  ),
});
