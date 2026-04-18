import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useReseed, useRemoveSeed, useSeed } from "@/hooks/use-seed";
import { ApiError } from "@/lib/api";
import type { SeedSummary } from "@/types/api";

function summaryLine(s: SeedSummary): string {
  return `${s.clients} clients, ${s.time_entries} time entries, ${s.invoices} invoices`;
}

export function SeedModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const seed = useSeed();
  const reseed = useReseed();
  const remove = useRemoveSeed();

  const handleError = React.useCallback(
    (err: unknown, fallback: string) => {
      const message =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : fallback;
      toast({ title: "Seed failed", description: message, variant: "destructive" });
    },
    [toast],
  );

  const runSeed = () =>
    seed.mutate(undefined, {
      onSuccess: (s) => {
        toast({ title: "Seeded demo data", description: summaryLine(s) });
        onOpenChange(false);
      },
      onError: (err) => handleError(err, "Could not seed demo data"),
    });

  const runReseed = () =>
    reseed.mutate(undefined, {
      onSuccess: (s) => {
        toast({ title: "Re-seeded demo data", description: summaryLine(s) });
        onOpenChange(false);
      },
      onError: (err) => handleError(err, "Could not re-seed demo data"),
    });

  const runRemove = () =>
    remove.mutate(undefined, {
      onSuccess: (s) => {
        toast({ title: "Removed demo data", description: summaryLine(s) });
        onOpenChange(false);
      },
      onError: (err) => handleError(err, "Could not remove demo data"),
    });

  const busy = seed.isPending || reseed.isPending || remove.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Demo data</DialogTitle>
          <DialogDescription>
            Seed, re-seed, or remove a set of fake clients, time entries, and invoices.
            Seeded invoices use your connected Stripe account — payments are real.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button onClick={runSeed} disabled={busy}>
            {seed.isPending ? "Seeding…" : "Seed"}
          </Button>
          <Button variant="outline" onClick={runReseed} disabled={busy}>
            {reseed.isPending ? "Re-seeding…" : "Re-seed"}
          </Button>
          <Button variant="destructive" onClick={runRemove} disabled={busy}>
            {remove.isPending ? "Removing…" : "Remove seed"}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
