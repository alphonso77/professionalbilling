import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { Me } from "@/types/api";

export function useMe() {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: ["me", orgId],
    enabled: !!orgId,
    queryFn: () => call<Me>("GET", "/api/me"),
  });
}
