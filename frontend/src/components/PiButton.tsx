import * as React from "react";
import { useMe } from "@/hooks/use-me";
import { SeedModal } from "@/components/SeedModal";

/**
 * Easter-egg π in the top-right. Pure-CSS reveal: invisible until hovered.
 * Click opens the seed modal. Conditionally rendered only when the caller
 * has `easter_egg_enabled = true`.
 */
export function PiButton() {
  const { data: me } = useMe();
  const [open, setOpen] = React.useState(false);

  if (!me?.user?.easter_egg_enabled) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Demo data"
        onClick={() => setOpen(true)}
        className="h-9 w-9 rounded-md text-lg leading-none text-[var(--color-muted-foreground)] opacity-0 transition-opacity duration-200 hover:opacity-40 active:opacity-70 focus-visible:opacity-70 focus-visible:outline-none"
      >
        π
      </button>
      <SeedModal open={open} onOpenChange={setOpen} />
    </>
  );
}
