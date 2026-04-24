import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, FileText, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useApproveSendInvoice,
  useInvoices,
  usePendingApprovalCount,
  useRejectInvoiceApproval,
} from "@/hooks/use-invoices";
import { useClients } from "@/hooks/use-clients";
import { useToast } from "@/hooks/use-toast";
import { centsToCurrency, cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import type { Invoice, InvoiceStatus } from "@/types/api";

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

type TabKey = "all" | "pending";

export function InvoicesPage() {
  const navigate = useNavigate();
  const [tab, setTab] = React.useState<TabKey>("all");
  const [statusFilter, setStatusFilter] = React.useState<"" | InvoiceStatus>("");
  const [clientFilter, setClientFilter] = React.useState<string>("");
  const clientsQ = useClients();
  const isPending = tab === "pending";
  const invoicesQ = useInvoices({
    status: isPending ? undefined : statusFilter || undefined,
    clientId: clientFilter || undefined,
    pendingApproval: isPending ? true : undefined,
  });
  const pendingCountQ = usePendingApprovalCount();

  const clientLookup = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clientsQ.data ?? []) m.set(c.id, c.name);
    return m;
  }, [clientsQ.data]);

  const selectClass =
    "flex h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 py-1 text-sm";

  const pendingCount = pendingCountQ.data ?? 0;

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
        <div
          role="tablist"
          aria-label="Invoice views"
          className="inline-flex rounded-md border border-[var(--color-border)] p-0.5"
        >
          <TabButton active={tab === "all"} onClick={() => setTab("all")}>
            All invoices
          </TabButton>
          <TabButton
            active={tab === "pending"}
            onClick={() => setTab("pending")}
          >
            Pending approval
            {pendingCount > 0 ? (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-primary)] px-1.5 text-xs font-semibold text-[var(--color-primary-foreground)]">
                {pendingCount}
              </span>
            ) : null}
          </TabButton>
        </div>

        {!isPending ? (
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
            <option value="refunded">Refunded</option>
            <option value="void">Void</option>
          </select>
        ) : null}
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
        isPending ? (
          <PendingApprovalTable
            rows={invoicesQ.data}
            clientLookup={clientLookup}
          />
        ) : (
          <AllInvoicesTable
            rows={invoicesQ.data}
            clientLookup={clientLookup}
            onRowClick={(id) => navigate(`/invoices/${id}`)}
          />
        )
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 p-16 text-center">
            <FileText className="h-10 w-10 text-[var(--color-muted-foreground)]" />
            <h2 className="text-lg font-medium">
              {isPending ? "Nothing pending approval" : "No invoices yet"}
            </h2>
            <p className="max-w-sm text-sm text-[var(--color-muted-foreground)]">
              {isPending
                ? "Auto-generated drafts awaiting approval will appear here."
                : "Draft your first invoice from unbilled time entries."}
            </p>
            {!isPending ? (
              <Button asChild>
                <Link to="/invoices/new">
                  <Plus className="h-4 w-4" /> New invoice
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded px-3 py-1 text-sm transition-colors",
        active
          ? "bg-[var(--color-accent)] text-[var(--color-foreground)] font-medium"
          : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
      )}
    >
      {children}
    </button>
  );
}

function AllInvoicesTable({
  rows,
  clientLookup,
  onRowClick,
}: {
  rows: Invoice[];
  clientLookup: Map<string, string>;
  onRowClick: (id: string) => void;
}) {
  return (
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
              {rows.map((inv) => (
                <tr
                  key={inv.id}
                  className="cursor-pointer hover:bg-[var(--color-accent)]"
                  onClick={() => onRowClick(inv.id)}
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
  );
}

function PendingApprovalTable({
  rows,
  clientLookup,
}: {
  rows: Invoice[];
  clientLookup: Map<string, string>;
}) {
  const navigate = useNavigate();
  const approveSend = useApproveSendInvoice();
  const rejectApproval = useRejectInvoiceApproval();
  const { toast } = useToast();

  const handleApprove = async (id: string) => {
    try {
      const res = await approveSend.mutateAsync(id);
      toast({
        title: "Invoice approved",
        description: res.number
          ? `Sent as ${res.number}`
          : "Finalized and sent.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Approve failed",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectApproval.mutateAsync(id);
      toast({
        title: "Draft rejected",
        description: "Time entries are unbilled again.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Reject failed",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pending approval</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Client</th>
                <th className="px-6 py-3 text-right font-medium">Total</th>
                <th className="px-6 py-3 text-left font-medium">Generated</th>
                <th className="px-6 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((inv) => (
                <tr key={inv.id} className="hover:bg-[var(--color-accent)]">
                  <td
                    className="cursor-pointer px-6 py-3"
                    onClick={() => navigate(`/invoices/${inv.id}`)}
                  >
                    {clientLookup.get(inv.clientId) ?? "—"}
                  </td>
                  <td className="px-6 py-3 text-right">
                    {centsToCurrency(inv.totalCents)}
                  </td>
                  <td className="px-6 py-3">
                    {formatDate(inv.autoGeneratedAt)}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleApprove(inv.id)}
                        disabled={
                          approveSend.isPending &&
                          approveSend.variables === inv.id
                        }
                      >
                        <Check className="h-4 w-4" />
                        Approve &amp; send
                      </Button>
                      <RejectButton onConfirm={() => handleReject(inv.id)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function RejectButton({ onConfirm }: { onConfirm: () => void | Promise<void> }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">
          <X className="h-4 w-4" />
          Reject
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reject this draft?</AlertDialogTitle>
          <AlertDialogDescription>
            The draft will be deleted and its time entries will become unbilled
            again. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]"
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
          >
            Reject
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
