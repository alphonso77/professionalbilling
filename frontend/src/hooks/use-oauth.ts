import { useMutation } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { OAuthAuthorizeResponse } from "@/types/api";

export function useAuthorizeStripe() {
  const { call } = useApi();
  return useMutation({
    mutationFn: () =>
      call<OAuthAuthorizeResponse>("POST", "/api/oauth/authorize/stripe"),
  });
}
