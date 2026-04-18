import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type {
  ArPreview,
  ArRunResult,
  ArSettings,
  UpdateArSettingsInput,
} from "@/types/api";

const SETTINGS_KEY = ["ar-settings"] as const;
const PREVIEW_KEY = ["ar-settings", "preview"] as const;

export function useArSettings() {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: [...SETTINGS_KEY, orgId],
    enabled: !!orgId,
    queryFn: () => call<ArSettings>("GET", "/api/ar-settings"),
  });
}

export function useUpdateArSettings() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateArSettingsInput) =>
      call<ArSettings>("PATCH", "/api/ar-settings", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SETTINGS_KEY });
      qc.invalidateQueries({ queryKey: PREVIEW_KEY });
    },
  });
}

export function useArPreview(enabled: boolean = true) {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: [...PREVIEW_KEY, orgId],
    enabled: !!orgId && enabled,
    queryFn: () => call<ArPreview>("GET", "/api/ar-settings/preview"),
  });
}

export function useRunArNow() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call<ArRunResult>("POST", "/api/ar-settings/run-now"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: PREVIEW_KEY });
    },
  });
}
