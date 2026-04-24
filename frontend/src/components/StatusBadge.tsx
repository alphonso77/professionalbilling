import { cn } from "@/lib/utils";
import type { InvoiceStatus } from "@/types/api";

const STYLES: Record<InvoiceStatus, string> = {
  draft: "bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)]",
  open: "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]",
  paid: "bg-emerald-600 text-white",
  void: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
  refunded: "bg-amber-600 text-white",
};

const LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  open: "Open",
  paid: "Paid",
  void: "Void",
  refunded: "Refunded",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STYLES[status],
      )}
    >
      {LABELS[status]}
    </span>
  );
}
