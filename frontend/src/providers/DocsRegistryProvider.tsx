import * as React from "react";
import { useDocsRegistry } from "@/hooks/use-docs-registry";
import type { DocsEntry, DocsRegistry } from "@/types/api";

type DocsRegistryContextValue = {
  registry: DocsRegistry | undefined;
  isLoading: boolean;
  error: unknown;
  findEntry: (key: string) => DocsEntry | undefined;
  findEntryBySlug: (slug: string) => DocsEntry | undefined;
};

const DocsRegistryContext = React.createContext<DocsRegistryContextValue | null>(
  null,
);

export function DocsRegistryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data, isLoading, error } = useDocsRegistry();

  const value = React.useMemo<DocsRegistryContextValue>(() => {
    const findEntry = (key: string) =>
      data?.categories.flatMap((c) => c.entries).find((e) => e.key === key);
    const findEntryBySlug = (slug: string) =>
      data?.categories.flatMap((c) => c.entries).find((e) => e.docSlug === slug);
    return {
      registry: data,
      isLoading,
      error,
      findEntry,
      findEntryBySlug,
    };
  }, [data, isLoading, error]);

  return (
    <DocsRegistryContext.Provider value={value}>
      {children}
    </DocsRegistryContext.Provider>
  );
}

export function useDocsContext() {
  const ctx = React.useContext(DocsRegistryContext);
  if (!ctx)
    throw new Error("useDocsContext must be used within <DocsRegistryProvider>");
  return ctx;
}

export function useDocsEntry(key: string): DocsEntry | undefined {
  const { findEntry } = useDocsContext();
  return findEntry(key);
}
