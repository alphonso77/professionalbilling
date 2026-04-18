import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Briefcase, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PaymentForm } from "@/components/PaymentForm";
import { usePublicInvoicePayment } from "@/hooks/use-invoices";
import { useToast } from "@/hooks/use-toast";
import { centsToCurrency } from "@/lib/utils";

export function PayInvoicePage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = searchParams.get("token");
  const paid = searchParams.get("paid") === "1";
  const { toast } = useToast();
  const [localPaid, setLocalPaid] = React.useState(false);
  const query = usePublicInvoicePayment(invoiceId, token);

  const showedPaidToast = React.useRef(false);
  React.useEffect(() => {
    if (paid && !showedPaidToast.current) {
      showedPaidToast.current = true;
      setLocalPaid(true);
      toast({ title: "Payment received" });
      const next = new URLSearchParams(searchParams);
      next.delete("paid");
      setSearchParams(next, { replace: true });
    }
  }, [paid, searchParams, setSearchParams, toast]);

  return (
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-card)]/60 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4">
          <Briefcase className="h-5 w-5 text-[var(--color-primary)]" />
          <span className="font-semibold tracking-tight">
            Professional Billing
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl p-6">
        {!token ? (
          <ErrorCard message="This link is missing a token." />
        ) : query.isLoading ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Loading…
          </p>
        ) : query.isError || !query.data ? (
          <ErrorCard
            message={
              query.error instanceof Error
                ? query.error.message
                : "We couldn't load this invoice. Check your link and try again."
            }
          />
        ) : localPaid || query.data.invoice.status === "paid" ? (
          <PaidCard
            invoice={query.data.invoice.number}
            amount={query.data.invoice.totalCents}
            orgName={query.data.invoice.orgName}
          />
        ) : query.data.invoice.status === "void" ? (
          <ErrorCard message="This invoice has been voided." />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                {query.data.invoice.orgName} · Invoice{" "}
                {query.data.invoice.number}
              </CardTitle>
              <CardDescription>
                {query.data.invoice.clientName}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4">
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  Amount due
                </div>
                <div className="text-2xl font-semibold">
                  {centsToCurrency(query.data.invoice.totalCents)}
                </div>
              </div>
              <PaymentForm
                clientSecret={query.data.stripeClientSecret}
                publishableKey={query.data.stripePublishableKey}
                connectedAccountId={query.data.connectedAccountId}
                onSuccess={() => {
                  setLocalPaid(true);
                  toast({ title: "Payment received" });
                }}
              />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
        <h2 className="text-lg font-medium">Unable to load invoice</h2>
        <p className="max-w-sm text-sm text-[var(--color-muted-foreground)]">
          {message}
        </p>
      </CardContent>
    </Card>
  );
}

function PaidCard({
  invoice,
  amount,
  orgName,
}: {
  invoice: string;
  amount: number;
  orgName: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        <h2 className="text-lg font-medium">Payment received</h2>
        <p className="max-w-sm text-sm text-[var(--color-muted-foreground)]">
          Invoice {invoice} from {orgName} has been paid in full (
          {centsToCurrency(amount)}). Thank you.
        </p>
      </CardContent>
    </Card>
  );
}
