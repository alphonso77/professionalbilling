import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function InvoicesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Generate and send invoices via Stripe or PDF.
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 p-16 text-center">
          <FileText className="h-10 w-10 text-[var(--color-muted-foreground)]" />
          <h2 className="text-lg font-medium">Coming soon</h2>
          <p className="max-w-sm text-sm text-[var(--color-muted-foreground)]">
            Invoice generation (Stripe + PDF) ships in Phase 2.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
