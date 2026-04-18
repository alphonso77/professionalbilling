import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { AdminUserRow, UpdateAdminUserInput } from "@/types/api";

const QUERY_KEY = ["admin", "users"] as const;

export function useAdminUsers() {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: [...QUERY_KEY, orgId],
    enabled: !!orgId,
    queryFn: () => call<AdminUserRow[]>("GET", "/api/admin/users"),
  });
}

export function useUpdateAdminUser() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAdminUserInput }) =>
      call<AdminUserRow>("PATCH", `/api/admin/users/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
