import { useAuth, useOrganization } from "@clerk/clerk-react";
import { useCallback } from "react";
import { request, type RequestOptions } from "@/lib/api";

export function useApi() {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.id ?? null;

  const call = useCallback(
    async <T,>(method: string, path: string, body?: unknown, extra?: Omit<RequestOptions, "getToken" | "orgId">) => {
      return request<T>(method, path, body, {
        getToken: () => getToken(),
        orgId,
        ...extra,
      });
    },
    [getToken, orgId],
  );

  return { call, orgId };
}
