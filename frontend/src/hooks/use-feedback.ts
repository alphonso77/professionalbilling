import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type {
  CreateFeedbackInput,
  FeedbackRow,
  UpdateFeedbackInput,
} from "@/types/api";

const FEEDBACK_KEY = ["feedback"] as const;
const ADMIN_FEEDBACK_KEY = ["admin", "feedback"] as const;

export function useFeedback() {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: [...FEEDBACK_KEY, orgId],
    enabled: !!orgId,
    queryFn: () => call<FeedbackRow[]>("GET", "/api/feedback"),
  });
}

export function useCreateFeedback() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFeedbackInput) =>
      call<FeedbackRow>("POST", "/api/feedback", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: FEEDBACK_KEY });
      qc.invalidateQueries({ queryKey: ADMIN_FEEDBACK_KEY });
    },
  });
}

export function useAdminFeedback() {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: [...ADMIN_FEEDBACK_KEY, orgId],
    enabled: !!orgId,
    queryFn: () => call<FeedbackRow[]>("GET", "/api/admin/feedback"),
  });
}

export function useUpdateAdminFeedback() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateFeedbackInput }) =>
      call<FeedbackRow>("PATCH", `/api/admin/feedback/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ADMIN_FEEDBACK_KEY });
    },
  });
}
