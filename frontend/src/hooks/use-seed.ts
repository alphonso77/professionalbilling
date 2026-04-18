import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { SeedSummary } from "@/types/api";

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["clients"] });
  qc.invalidateQueries({ queryKey: ["time-entries"] });
  qc.invalidateQueries({ queryKey: ["invoices"] });
}

export function useSeed() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call<SeedSummary>("POST", "/api/seed"),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useReseed() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call<SeedSummary>("POST", "/api/seed/reseed"),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRemoveSeed() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call<SeedSummary>("DELETE", "/api/seed"),
    onSuccess: () => invalidateAll(qc),
  });
}
