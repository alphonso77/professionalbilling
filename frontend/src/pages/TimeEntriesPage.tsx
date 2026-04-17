import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { InfoBubble } from "@/components/InfoBubble";
import { useTimeEntries, useCreateTimeEntry } from "@/hooks/use-time-entries";
import { useClients } from "@/hooks/use-clients";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api";
import { formatDateTime, minutesToHours } from "@/lib/utils";

const timeEntrySchema = z
  .object({
    description: z.string().min(1, "Description is required"),
    client_id: z.string().optional(),
    started_at: z.string().min(1, "Start time is required"),
    ended_at: z.string().min(1, "End time is required"),
    hourly_rate_cents: z
      .union([z.string().length(0), z.string().regex(/^\d+$/, "Must be a whole number")])
      .optional(),
  })
  .refine(
    (v) => new Date(v.started_at).getTime() < new Date(v.ended_at).getTime(),
    { message: "End must be after start", path: ["ended_at"] },
  );

type TimeEntryFormValues = z.infer<typeof timeEntrySchema>;

function toIsoFromLocal(localValue: string) {
  return new Date(localValue).toISOString();
}

export function TimeEntriesPage() {
  const entriesQ = useTimeEntries();
  const clientsQ = useClients();
  const createEntry = useCreateTimeEntry();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);

  const form = useForm<TimeEntryFormValues>({
    resolver: zodResolver(timeEntrySchema),
    defaultValues: {
      description: "",
      client_id: "",
      started_at: "",
      ended_at: "",
      hourly_rate_cents: "",
    },
  });

  const clientLookup = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clientsQ.data ?? []) m.set(c.id, c.name);
    return m;
  }, [clientsQ.data]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const res = await createEntry.mutateAsync({
        description: values.description,
        client_id: values.client_id || undefined,
        started_at: toIsoFromLocal(values.started_at),
        ended_at: toIsoFromLocal(values.ended_at),
        hourly_rate_cents: values.hourly_rate_cents
          ? Number(values.hourly_rate_cents)
          : undefined,
      });
      if (res.warnings && res.warnings.length > 0) {
        for (const w of res.warnings) {
          toast({ variant: "warning", title: "Heads up", description: w });
        }
      } else {
        toast({ title: "Time entry logged" });
      }
      form.reset();
      setOpen(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not log entry",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Time</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Log billable hours and assign them to clients.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" /> Log time
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Log time</DialogTitle>
              <DialogDescription>
                Record work you&apos;ve done. Unassigned entries won&apos;t be invoiced automatically.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  rows={2}
                  {...form.register("description")}
                  autoFocus
                />
                {form.formState.errors.description ? (
                  <p className="text-xs text-[var(--color-destructive)]">
                    {form.formState.errors.description.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="client_id">Client</Label>
                  <InfoBubble entryKey="time-entry-client-assignment" />
                </div>
                <select
                  id="client_id"
                  className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 py-1 text-sm"
                  {...form.register("client_id")}
                >
                  <option value="">— Unassigned —</option>
                  {(clientsQ.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="started_at">Start</Label>
                  <Input
                    id="started_at"
                    type="datetime-local"
                    {...form.register("started_at")}
                  />
                  {form.formState.errors.started_at ? (
                    <p className="text-xs text-[var(--color-destructive)]">
                      {form.formState.errors.started_at.message}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ended_at">End</Label>
                  <Input
                    id="ended_at"
                    type="datetime-local"
                    {...form.register("ended_at")}
                  />
                  {form.formState.errors.ended_at ? (
                    <p className="text-xs text-[var(--color-destructive)]">
                      {form.formState.errors.ended_at.message}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hourly_rate_cents">Hourly rate (cents, optional)</Label>
                <Input
                  id="hourly_rate_cents"
                  inputMode="numeric"
                  placeholder="e.g. 20000 for $200/hr"
                  {...form.register("hourly_rate_cents")}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createEntry.isPending}>
                  {createEntry.isPending ? "Saving…" : "Save entry"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {entriesQ.isLoading ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
      ) : entriesQ.data && entriesQ.data.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent entries</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-[var(--color-border)]">
              {entriesQ.data.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-4 px-6 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{e.description}</div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">
                      {formatDateTime(e.started_at)} →{" "}
                      {formatDateTime(e.ended_at)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-medium">
                      {minutesToHours(e.duration_minutes)}
                    </div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">
                      {e.client_id
                        ? clientLookup.get(e.client_id) ?? "Unknown client"
                        : "Unassigned"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 p-10 text-center">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              No time entries yet. Log your first one.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
