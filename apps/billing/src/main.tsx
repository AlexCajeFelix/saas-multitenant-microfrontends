import { Route } from "react-router-dom";
import { mountZone } from "@saas/platform/zone";
import { NotFound } from "@saas/platform/components/NotFound";
import { SubscriptionPage } from "./routes/SubscriptionPage";
import { Plans } from "./routes/Plans";
import { Usage } from "./routes/Usage";
import { Invoices } from "./routes/Invoices";
import { InvoiceDetail } from "./routes/InvoiceDetail";

mountZone({
  zone: "billing",
  routes: (
    <>
      <Route path="billing/assinatura" element={<SubscriptionPage />} />
      <Route path="billing/planos" element={<Plans />} />
      <Route path="billing/consumo" element={<Usage />} />
      <Route path="billing/faturas" element={<Invoices />} />
      <Route path="billing/faturas/:id" element={<InvoiceDetail />} />
      <Route path="*" element={<NotFound />} />
    </>
  ),
});
