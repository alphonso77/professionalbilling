import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type {
  AdminUserRow,
  AllUsersRow,
  UpdateAdminUserInput,
} from "@/types/api";

const QUERY_KEY = ["admin", "users"] as const;
const ALL_USERS_KEY = ["admin", "all-users"] as const;

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
      qc.invalidateQueries({ queryKey: ALL_USERS_KEY });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useAdminAllUsers(enabled: boolean) {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: [...ALL_USERS_KEY, orgId],
    enabled: enabled && !!orgId,
    queryFn: () => call<AllUsersRow[]>("GET", "/api/admin/all-users"),
  });
}
