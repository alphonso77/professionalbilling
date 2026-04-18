import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useClients } from "@/hooks/use-clients";
import {
  useCreateInvoice,
  useUnbilledTimeEntries,
} from "@/hooks/use-invoices";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api";
import {
  centsToCurrency,
  formatDateTime,
  minutesToHours,
} from "@/lib/utils";

export function NewInvoicePage() {
  const navigate = useNavigate();
  const clientsQ = useClients();
  const createInvoice = useCreateInvoice();
  const { toast } = useToast();

  const [clientId, setClientId] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const unbilledQ = useUnbilledTimeEntries(clientId || undefined);
  const entries = unbilledQ.data ?? [];

  React.useEffect(() => {
    setSelected(new Set());
  }, [clientId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === entries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map((e) => e.id)));
    }
  };

  const runningTotal = React.useMemo(() => {
    let total = 0;
    for (const e of entries) {
      if (!selected.has(e.id)) continue;
      const rate = e.hourly_rate_cents ?? 0;
      total += (rate * e.duration_minutes) / 60;
    }
    return Math.round(total);
  }, [entries, selected]);

  const canSubmit =
    clientId && selected.size > 0 && !createInvoice.isPending;

  const submit = async () => {
    try {
      const invoice = await createInvoice.mutateAsync({
        clientId,
        timeEntryIds: Array.from(selected),
        dueDate: dueDate || undefined,
        notes: notes || undefined,
      });
      toast({ title: "Draft invoice created" });
      navigate(`/invoices/${invoice.id}`);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not create invoice",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/invoices")}
            className="-ml-2 mb-2"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">New invoice</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Select unbilled time entries for a client to draft an invoice.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Client</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Label htmlFor="client_id">Client</Label>
          <select
            id="client_id"
            className="flex h-9 w-full max-w-sm rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 py-1 text-sm"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">— Select a client —</option>
            {(clientsQ.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {clientId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Unbilled time</CardTitle>
            <CardDescription>
              Check the entries you want on this invoice.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {unbilledQ.isLoading ? (
              <p className="px-6 py-4 text-sm text-[var(--color-muted-foreground)]">
                Loading…
              </p>
            ) : entries.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-[var(--color-muted-foreground)]">
                No unbilled time for this client yet.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                      <tr>
                        <th className="w-10 px-6 py-3">
                          <input
                            type="checkbox"
                            aria-label="Select all"
                            checked={
                              entries.length > 0 &&
                              selected.size === entries.length
                            }
                            onChange={toggleAll}
                          />
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Description
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Started
                        </th>
                        <th className="px-4 py-3 text-right font-medium">
                          Duration
                        </th>
                        <th className="px-4 py-3 text-right font-medium">
                          Rate
                        </th>
                        <th className="px-6 py-3 text-right font-medium">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {entries.map((e) => {
                        const rate = e.hourly_rate_cents ?? 0;
                        const amount = Math.round(
                          (rate * e.duration_minutes) / 60,
                        );
                        return (
                          <tr
                            key={e.id}
                            className="cursor-pointer hover:bg-[var(--color-accent)]"
                            onClick={() => toggle(e.id)}
                          >
                            <td
                              className="px-6 py-3"
                              onClick={(ev) => ev.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                aria-label={`Select ${e.description}`}
                                checked={selected.has(e.id)}
                                onChange={() => toggle(e.id)}
                              />
                            </td>
                            <td className="px-4 py-3">{e.description}</td>
                            <td className="px-4 py-3 text-[var(--color-muted-foreground)]">
                              {formatDateTime(e.started_at)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {minutesToHours(e.duration_minutes)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {e.hourly_rate_cents != null
                                ? centsToCurrency(e.hourly_rate_cents)
                                : "—"}
                            </td>
                            <td className="px-6 py-3 text-right font-medium">
                              {centsToCurrency(amount)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-[var(--color-border)] px-6 py-3 text-sm">
                  <span className="text-[var(--color-muted-foreground)]">
                    {selected.size} of {entries.length} selected
                  </span>
                  <span className="font-semibold">
                    Total {centsToCurrency(runningTotal)}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {clientId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dueDate">Due date</Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="max-w-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate("/invoices")}>
          Cancel
        </Button>
        <Button disabled={!canSubmit} onClick={submit}>
          {createInvoice.isPending ? "Creating…" : "Create draft"}
        </Button>
      </div>
    </div>
  );
}
