import { Bell } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function AlertsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Configure email and Slack notifications for invoice events.
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 p-16 text-center">
          <Bell className="h-10 w-10 text-[var(--color-muted-foreground)]" />
          <h2 className="text-lg font-medium">Coming soon</h2>
          <p className="max-w-sm text-sm text-[var(--color-muted-foreground)]">
            Configurable alerts and channels ship in Phase 2.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
