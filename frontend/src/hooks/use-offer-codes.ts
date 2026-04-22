import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import { request } from "@/lib/api";
import type {
  CreateOfferCodeInput,
  OfferCodeRow,
  RedeemOfferCodeInput,
} from "@/types/api";

const OFFER_CODES_KEY = ["admin", "offer-codes"] as const;

export function useAdminOfferCodes(enabled: boolean) {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: [...OFFER_CODES_KEY, orgId],
    enabled: enabled && !!orgId,
    queryFn: () => call<OfferCodeRow[]>("GET", "/api/admin/offer-codes"),
  });
}

export function useCreateOfferCode() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOfferCodeInput = {}) =>
      call<OfferCodeRow>("POST", "/api/admin/offer-codes", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OFFER_CODES_KEY });
    },
  });
}

export function useDeactivateOfferCode() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      call<OfferCodeRow>("POST", `/api/admin/offer-codes/${id}/deactivate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OFFER_CODES_KEY });
    },
  });
}

/**
 * Public redeem — unauthenticated, called from the /sign-up gate.
 * Does not use useApi() because there's no session token or org header.
 */
export async function redeemOfferCode(
  input: RedeemOfferCodeInput,
): Promise<{ ok: true }> {
  return request<{ ok: true }>("POST", "/api/public/offer-codes/redeem", input);
}
