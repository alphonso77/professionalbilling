import { Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/AppShell";
import { TutorialOverlay } from "@/components/TutorialOverlay";
import { DocsRegistryProvider } from "@/providers/DocsRegistryProvider";
import { TutorialProvider } from "@/lib/tutorial-context";
import { DashboardPage } from "@/pages/DashboardPage";
import { TimeEntriesPage } from "@/pages/TimeEntriesPage";
import { ClientsPage } from "@/pages/ClientsPage";
import { InvoicesPage } from "@/pages/InvoicesPage";
import { NewInvoicePage } from "@/pages/NewInvoicePage";
import { InvoiceDetailPage } from "@/pages/InvoiceDetailPage";
import { AlertsPage } from "@/pages/AlertsPage";
import { IntegrationsPage } from "@/pages/IntegrationsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { DocsPage } from "@/pages/DocsPage";
import { AdminPage } from "@/pages/AdminPage";
import { FeedbackPage } from "@/pages/FeedbackPage";

export function ProtectedRoutes() {
  return (
    <TutorialProvider>
      <DocsRegistryProvider>
        <TooltipProvider delayDuration={200}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="time" element={<TimeEntriesPage />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="invoices" element={<InvoicesPage />} />
              <Route path="invoices/new" element={<NewInvoicePage />} />
              <Route path="invoices/:id" element={<InvoiceDetailPage />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="settings/integrations" element={<IntegrationsPage />} />
              <Route path="docs" element={<DocsPage />} />
              <Route path="docs/:slug" element={<DocsPage />} />
              <Route path="feedback" element={<FeedbackPage />} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="admin/users" element={<AdminPage />} />
              <Route path="*" element={<DashboardPage />} />
            </Route>
          </Routes>
          <TutorialOverlay />
        </TooltipProvider>
      </DocsRegistryProvider>
    </TutorialProvider>
  );
}
