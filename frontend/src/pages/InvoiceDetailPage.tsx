import * as React from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, ExternalLink, Trash2, X } from "lucide-react";
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
import { StatusBadge } from "@/components/StatusBadge";
import { PaymentForm } from "@/components/PaymentForm";
import {
  useDeleteInvoice,
  useFinalizeInvoice,
  useInvoice,
  useSendInvoice,
  useUpdateInvoice,
  useVoidInvoice,
} from "@/hooks/use-invoices";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api";
import {
  centsToCurrency,
  formatDateTime,
  minutesToHours,
} from "@/lib/utils";

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

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();

  const invoiceQ = useInvoice(id);
  const update = useUpdateInvoice(id ?? "");
  const finalize = useFinalizeInvoice(id ?? "");
  const send = useSendInvoice(id ?? "");
  const voidInv = useVoidInvoice(id ?? "");
  const del = useDeleteInvoice();

  const [emailSent, setEmailSent] = React.useState(false);

  const showedPaidToast = React.useRef(false);
  React.useEffect(() => {
    if (searchParams.get("paid") === "1" && !showedPaidToast.current) {
      showedPaidToast.current = true;
      toast({ title: "Payment received" });
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      const next = new URLSearchParams(searchParams);
      next.delete("paid");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, toast, qc, id]);

  if (invoiceQ.isLoading) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
    );
  }

  if (invoiceQ.isError || !invoiceQ.data) {
    return (
      <div className="space-y-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/invoices")}
          className="-ml-2"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <p className="text-sm text-[var(--color-destructive)]">
          {invoiceQ.error instanceof ApiError
            ? invoiceQ.error.message
            : "Invoice not found."}
        </p>
      </div>
    );
  }

  const inv = invoiceQ.data;
  const { lineItems, client, status } = inv;

  const handleFinalize = async () => {
    try {
      await finalize.mutateAsync();
      toast({ title: "Invoice finalized" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not finalize",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  const handleSend = async () => {
    try {
      const result = await send.mutateAsync();
      setEmailSent(true);
      if (result.warnings?.length) {
        toast({
          variant: "warning",
          title: "Email skipped",
          description: result.warnings[0],
        });
      } else {
        toast({ title: "Email queued" });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not send email",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  const handleCopyPaymentUrl = async () => {
    if (!inv.paymentUrl) return;
    try {
      await navigator.clipboard.writeText(inv.paymentUrl);
      toast({ title: "Payment link copied" });
    } catch {
      toast({
        variant: "destructive",
        title: "Could not copy link",
        description: "Copy the URL from the address bar instead.",
      });
    }
  };

  const handleVoid = async () => {
    try {
      await voidInv.mutateAsync();
      toast({ title: "Invoice voided" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not void",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  const handleDelete = async () => {
    try {
      await del.mutateAsync(inv.id);
      toast({ title: "Invoice deleted" });
      navigate("/invoices");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not delete",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  const handleRemoveLineItem = async (lineItemId: string) => {
    try {
      await update.mutateAsync({ removeLineItemIds: [lineItemId] });
      toast({ title: "Line item removed" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not remove line item",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  const canShowPaymentForm =
    status === "open" &&
    inv.stripeClientSecret &&
    inv.stripePublishableKey &&
    inv.connectedAccountId;

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/invoices")}
          className="-ml-2 mb-2"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                {inv.number ?? "Draft invoice"}
              </h1>
              <StatusBadge status={status} />
            </div>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {client.name}
              {client.email ? ` · ${client.email}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {status === "draft" ? (
              <>
                <Button onClick={handleFinalize} disabled={finalize.isPending}>
                  {finalize.isPending ? "Finalizing…" : "Finalize"}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <Trash2 className="h-4 w-4" /> Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete draft invoice?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This can&apos;t be undone. Time entries on it will
                        become unbilled again.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : null}
            {status === "open" ? (
              <>
                <Button onClick={handleSend} disabled={send.isPending}>
                  {emailSent ? "Email sent" : send.isPending ? "Sending…" : "Send email"}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline">
                      <X className="h-4 w-4" /> Void
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Void this invoice?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The invoice is marked void and the Stripe PaymentIntent
                        is cancelled. Time entries become unbilled again.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleVoid}>
                        Void
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <InfoTile label="Issued" value={formatDate(inv.issueDate)} />
        <InfoTile label="Due" value={formatDate(inv.dueDate)} />
        <InfoTile label="Total" value={centsToCurrency(inv.totalCents)} />
        <InfoTile
          label={status === "paid" ? "Paid on" : "Status"}
          value={
            status === "paid"
              ? formatDate(inv.paidAt)
              : status.charAt(0).toUpperCase() + status.slice(1)
          }
        />
      </div>

      {inv.paymentUnavailableReason === "seed_requires_test_mode" ? (
        <Card>
          <CardContent className="py-3 text-sm text-[var(--color-muted-foreground)]">
            Seeded invoice — payment is disabled because Stripe is in live mode.
          </CardContent>
        </Card>
      ) : null}

      {inv.paymentUrl ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <div className="text-sm font-medium">Public payment page</div>
              <div className="truncate text-xs text-[var(--color-muted-foreground)]">
                {inv.paymentUrl}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyPaymentUrl}
              >
                <Copy className="h-4 w-4" /> Copy link
              </Button>
              <a
                href={inv.paymentUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm">
                  <ExternalLink className="h-4 w-4" /> View payment page
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Line items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lineItems.length === 0 ? (
            <p className="px-6 py-6 text-sm text-[var(--color-muted-foreground)]">
              No line items.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium">
                      Description
                    </th>
                    <th className="px-4 py-3 text-right font-medium">Hours</th>
                    <th className="px-4 py-3 text-right font-medium">Rate</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    {status === "draft" ? (
                      <th className="px-6 py-3 text-right font-medium w-10"></th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {lineItems.map((li) => (
                    <tr key={li.id}>
                      <td className="px-6 py-3">{li.description}</td>
                      <td className="px-4 py-3 text-right">
                        {minutesToHours(Math.round(li.quantityHours * 60))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {centsToCurrency(li.rateCents)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {centsToCurrency(li.amountCents)}
                      </td>
                      {status === "draft" ? (
                        <td className="px-6 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remove line item"
                            onClick={() => handleRemoveLineItem(li.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--color-border)] font-semibold">
                    <td className="px-6 py-3" colSpan={3}>
                      Total
                    </td>
                    <td className="px-4 py-3 text-right">
                      {centsToCurrency(inv.totalCents)}
                    </td>
                    {status === "draft" ? <td /> : null}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {inv.notes ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{inv.notes}</p>
          </CardContent>
        </Card>
      ) : null}

      {canShowPaymentForm ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Take payment</CardTitle>
          </CardHeader>
          <CardContent>
            <PaymentForm
              clientSecret={inv.stripeClientSecret as string}
              publishableKey={inv.stripePublishableKey as string}
              connectedAccountId={inv.connectedAccountId as string}
              onSuccess={() => {
                toast({ title: "Payment received" });
                qc.invalidateQueries({ queryKey: ["invoice", id] });
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {status === "paid" ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-[var(--color-muted-foreground)]">
            Paid {formatDateTime(inv.paidAt ?? inv.updatedAt)}.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
      <div className="text-xs text-[var(--color-muted-foreground)]">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
