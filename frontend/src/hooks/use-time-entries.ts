import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import { buildQuery } from "@/lib/api";
import type {
  CreateTimeEntryInput,
  CreateTimeEntryResponse,
  TimeEntry,
} from "@/types/api";

type TimeEntriesFilter = {
  client_id?: string;
  from?: string;
  to?: string;
};

const QUERY_KEY = ["time-entries"] as const;

export function useTimeEntries(filter: TimeEntriesFilter = {}) {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: [...QUERY_KEY, orgId, filter],
    enabled: !!orgId,
    queryFn: () =>
      call<TimeEntry[]>("GET", `/api/time-entries${buildQuery(filter)}`),
  });
}

export function useCreateTimeEntry() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTimeEntryInput) =>
      call<CreateTimeEntryResponse>("POST", "/api/time-entries", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
