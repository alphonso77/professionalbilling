import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { OAuthAuthorizeResponse, Platform } from "@/types/api";

const PLATFORMS_KEY = ["platforms"] as const;

export function useAuthorizeStripe() {
  const { call } = useApi();
  return useMutation({
    mutationFn: () =>
      call<OAuthAuthorizeResponse>("POST", "/api/oauth/authorize/stripe"),
  });
}

export function usePlatforms() {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: [...PLATFORMS_KEY, orgId],
    enabled: !!orgId,
    queryFn: () => call<Platform[]>("GET", "/api/platforms"),
  });
}

export function useDisconnectStripe() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      call<null>("DELETE", `/api/platforms/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLATFORMS_KEY });
    },
  });
}
