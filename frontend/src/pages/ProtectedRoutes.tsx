import { Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/AppShell";
import { DocsRegistryProvider } from "@/providers/DocsRegistryProvider";
import { DashboardPage } from "@/pages/DashboardPage";
import { TimeEntriesPage } from "@/pages/TimeEntriesPage";
import { ClientsPage } from "@/pages/ClientsPage";
import { InvoicesPage } from "@/pages/InvoicesPage";
import { AlertsPage } from "@/pages/AlertsPage";
import { IntegrationsPage } from "@/pages/IntegrationsPage";
import { DocsPage } from "@/pages/DocsPage";

export function ProtectedRoutes() {
  return (
    <DocsRegistryProvider>
      <TooltipProvider delayDuration={200}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="time" element={<TimeEntriesPage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="settings/integrations" element={<IntegrationsPage />} />
            <Route path="docs" element={<DocsPage />} />
            <Route path="docs/:slug" element={<DocsPage />} />
            <Route path="*" element={<DashboardPage />} />
          </Route>
        </Routes>
      </TooltipProvider>
    </DocsRegistryProvider>
  );
}
