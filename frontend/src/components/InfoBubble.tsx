import * as React from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDocsEntry } from "@/providers/DocsRegistryProvider";
import { InfoModal } from "@/components/InfoModal";
import { cn } from "@/lib/utils";

type InfoBubbleProps = {
  entryKey: string;
  className?: string;
  ariaLabel?: string;
};

export function InfoBubble({ entryKey, className, ariaLabel }: InfoBubbleProps) {
  const entry = useDocsEntry(entryKey);
  const [modalOpen, setModalOpen] = React.useState(false);

  if (!entry) return null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={ariaLabel ?? `More information: ${entry.label}`}
            onClick={() => setModalOpen(true)}
            className={cn(
              "inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              className,
            )}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <p>{entry.tooltip}</p>
            <p className="text-[var(--color-primary)]">Click for details →</p>
          </div>
        </TooltipContent>
      </Tooltip>
      <InfoModal open={modalOpen} onOpenChange={setModalOpen} entry={entry} />
    </>
  );
}
