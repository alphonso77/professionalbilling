import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { Me, UpdateMeInput } from "@/types/api";

export function useMe() {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: ["me", orgId],
    enabled: !!orgId,
    queryFn: () => call<Me>("GET", "/api/me"),
  });
}

export function useUpdateMe() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMeInput) => call<Me>("PATCH", "/api/me", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
