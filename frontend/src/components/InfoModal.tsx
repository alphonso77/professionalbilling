import { Link } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { DocsEntry } from "@/types/api";

type InfoModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: DocsEntry;
};

export function InfoModal({ open, onOpenChange, entry }: InfoModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{entry.label}</DialogTitle>
          <DialogDescription>{entry.tooltip}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-[var(--color-foreground)] whitespace-pre-wrap">
            {entry.detail}
          </p>
          {entry.whatWeMeasure ? (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                What we measure
              </h4>
              <p className="mt-1 text-[var(--color-foreground)]">
                {entry.whatWeMeasure}
              </p>
            </section>
          ) : null}
          {entry.thresholds && entry.thresholds.length > 0 ? (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                Thresholds
              </h4>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {entry.thresholds.map((t) => (
                    <tr
                      key={t.label}
                      className="border-b border-[var(--color-border)] last:border-0"
                    >
                      <td className="py-1 pr-4 font-medium">{t.label}</td>
                      <td className="py-1 pr-4 text-[var(--color-muted-foreground)]">
                        {t.range}
                      </td>
                      <td className="py-1">{t.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
          {entry.commonMisunderstanding ? (
            <section className="rounded-md border border-[var(--color-warning)] bg-[var(--color-warning)]/10 p-3 text-[var(--color-foreground)]">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-warning)]">
                Common misunderstanding
              </h4>
              <p className="mt-1">{entry.commonMisunderstanding}</p>
            </section>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            asChild
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            <Link to={`/docs/${entry.docSlug}`}>Open full docs →</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
