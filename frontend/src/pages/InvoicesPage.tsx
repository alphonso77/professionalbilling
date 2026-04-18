import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useInvoices } from "@/hooks/use-invoices";
import { useClients } from "@/hooks/use-clients";
import { centsToCurrency } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import type { InvoiceStatus } from "@/types/api";

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function InvoicesPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = React.useState<"" | InvoiceStatus>("");
  const [clientFilter, setClientFilter] = React.useState<string>("");
  const clientsQ = useClients();
  const invoicesQ = useInvoices({
    status: statusFilter || undefined,
    clientId: clientFilter || undefined,
  });

  const clientLookup = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clientsQ.data ?? []) m.set(c.id, c.name);
    return m;
  }, [clientsQ.data]);

  const selectClass =
    "flex h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Draft, send, and track payment on invoices.
          </p>
        </div>
        <Button onClick={() => navigate("/invoices/new")}>
          <Plus className="h-4 w-4" /> New invoice
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Filter by status"
          className={selectClass}
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "" | InvoiceStatus)
          }
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="open">Open</option>
          <option value="paid">Paid</option>
          <option value="void">Void</option>
        </select>
        <select
          aria-label="Filter by client"
          className={selectClass}
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
        >
          <option value="">All clients</option>
          {(clientsQ.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {invoicesQ.isLoading ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
      ) : invoicesQ.data && invoicesQ.data.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All invoices</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium">Number</th>
                    <th className="px-6 py-3 text-left font-medium">Client</th>
                    <th className="px-6 py-3 text-left font-medium">Status</th>
                    <th className="px-6 py-3 text-right font-medium">Total</th>
                    <th className="px-6 py-3 text-left font-medium">Issued</th>
                    <th className="px-6 py-3 text-left font-medium">Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {invoicesQ.data.map((inv) => (
                    <tr
                      key={inv.id}
                      className="cursor-pointer hover:bg-[var(--color-accent)]"
                      onClick={() => navigate(`/invoices/${inv.id}`)}
                    >
                      <td className="px-6 py-3 font-medium">
                        {inv.number ?? (
                          <span className="text-[var(--color-muted-foreground)]">
                            Draft
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        {clientLookup.get(inv.clientId) ?? "—"}
                      </td>
                      <td className="px-6 py-3">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="px-6 py-3 text-right">
                        {centsToCurrency(inv.totalCents)}
                      </td>
                      <td className="px-6 py-3">{formatDate(inv.issueDate)}</td>
                      <td className="px-6 py-3">{formatDate(inv.dueDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 p-16 text-center">
            <FileText className="h-10 w-10 text-[var(--color-muted-foreground)]" />
            <h2 className="text-lg font-medium">No invoices yet</h2>
            <p className="max-w-sm text-sm text-[var(--color-muted-foreground)]">
              Draft your first invoice from unbilled time entries.
            </p>
            <Button asChild>
              <Link to="/invoices/new">
                <Plus className="h-4 w-4" /> New invoice
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
