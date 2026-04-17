import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { Client, CreateClientInput } from "@/types/api";

const QUERY_KEY = ["clients"] as const;

export function useClients() {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: [...QUERY_KEY, orgId],
    enabled: !!orgId,
    queryFn: () => call<Client[]>("GET", "/api/clients"),
  });
}

export function useCreateClient() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateClientInput) =>
      call<Client>("POST", "/api/clients", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

export function useDeleteClient() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      call<{ id: string }>("DELETE", `/api/clients/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
