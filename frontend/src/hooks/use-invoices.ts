import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import { buildQuery } from "@/lib/api";
import type {
  CreateInvoiceInput,
  Invoice,
  InvoiceStatus,
  InvoiceWithItems,
  PublicInvoicePayment,
  TimeEntry,
  UpdateInvoiceInput,
} from "@/types/api";

const LIST_KEY = ["invoices"] as const;
const DETAIL_KEY = (id: string) => ["invoice", id] as const;
const UNBILLED_KEY = ["time-entries", "unbilled"] as const;
const PUBLIC_INVOICE_KEY = (id: string, token: string) =>
  ["public-invoice", id, token] as const;

type InvoiceFilters = {
  status?: InvoiceStatus;
  clientId?: string;
};

export function useInvoices(filters: InvoiceFilters = {}) {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: [...LIST_KEY, orgId, filters],
    enabled: !!orgId,
    queryFn: () => call<Invoice[]>("GET", `/api/invoices${buildQuery(filters)}`),
  });
}

export function useInvoice(id: string | undefined) {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: [...DETAIL_KEY(id ?? ""), orgId],
    enabled: !!orgId && !!id,
    queryFn: () => call<InvoiceWithItems>("GET", `/api/invoices/${id}`),
  });
}

export function useUnbilledTimeEntries(clientId: string | undefined) {
  const { call, orgId } = useApi();
  return useQuery({
    queryKey: [...UNBILLED_KEY, orgId, clientId],
    enabled: !!orgId && !!clientId,
    queryFn: () =>
      call<TimeEntry[]>(
        "GET",
        `/api/time-entries${buildQuery({ unbilled: "true", clientId })}`,
      ),
  });
}

export function useCreateInvoice() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvoiceInput) =>
      call<InvoiceWithItems>("POST", "/api/invoices", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: UNBILLED_KEY });
    },
  });
}

export function useUpdateInvoice(id: string) {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateInvoiceInput) =>
      call<InvoiceWithItems>("PATCH", `/api/invoices/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DETAIL_KEY(id) });
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: UNBILLED_KEY });
    },
  });
}

export function useFinalizeInvoice(id: string) {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      call<InvoiceWithItems>("POST", `/api/invoices/${id}/finalize`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DETAIL_KEY(id) });
      qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useSendInvoice(id: string) {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call<Invoice>("POST", `/api/invoices/${id}/send`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DETAIL_KEY(id) });
    },
  });
}

export function useVoidInvoice(id: string) {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call<Invoice>("POST", `/api/invoices/${id}/void`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DETAIL_KEY(id) });
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: UNBILLED_KEY });
    },
  });
}

export function useDeleteInvoice() {
  const { call } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      call<{ id: string }>("DELETE", `/api/invoices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: UNBILLED_KEY });
    },
  });
}

export function usePublicInvoicePayment(
  invoiceId: string | undefined,
  token: string | null,
) {
  return useQuery({
    queryKey: PUBLIC_INVOICE_KEY(invoiceId ?? "", token ?? ""),
    enabled: !!invoiceId && !!token,
    queryFn: async () => {
      const baseUrl =
        (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
        "http://localhost:3000";
      const url = `${baseUrl}/api/public/invoices/${invoiceId}?token=${encodeURIComponent(
        token ?? "",
      )}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      const text = await res.text();
      const parsed = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const message =
          (parsed && typeof parsed === "object" && "error" in parsed
            ? (parsed as { error?: { message?: string } | string }).error
            : null) ?? `Request failed: ${res.status}`;
        const err = new Error(
          typeof message === "string" ? message : message.message ?? "Error",
        ) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return (parsed as { data: PublicInvoicePayment }).data;
    },
    retry: false,
  });
}
