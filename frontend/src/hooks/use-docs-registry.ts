import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { DocsRegistry } from "@/types/api";

export function useDocsRegistry() {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: ["docs-registry", orgId],
    enabled: !!orgId,
    staleTime: Infinity,
    queryFn: () => call<DocsRegistry>("GET", "/api/docs"),
  });
}
