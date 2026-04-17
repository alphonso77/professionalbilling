import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTimeEntries } from "@/hooks/use-time-entries";
import { useClients } from "@/hooks/use-clients";
import { minutesToHours } from "@/lib/utils";

export function DashboardPage() {
  const timeQ = useTimeEntries();
  const clientsQ = useClients();

  const totalMinutes = (timeQ.data ?? []).reduce(
    (sum, e) => sum + (e.duration_minutes ?? 0),
    0,
  );
  const unassigned = (timeQ.data ?? []).filter((e) => !e.client_id).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Overview of your billable activity.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Time logged</CardDescription>
            <CardTitle>{minutesToHours(totalMinutes)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {timeQ.data?.length ?? 0} entries total
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Clients</CardDescription>
            <CardTitle>{clientsQ.data?.length ?? 0}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Active client records
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Unassigned entries</CardDescription>
            <CardTitle>{unassigned}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Won&apos;t be automatically invoiced
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
