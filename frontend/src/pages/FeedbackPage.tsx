import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFeedback, useCreateFeedback } from "@/hooks/use-feedback";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api";
import type { FeedbackRow, FeedbackStatus, FeedbackType } from "@/types/api";

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "Bug",
  feature: "Feature",
  ui: "UI / UX",
  other: "Other",
};

const TYPE_ORDER: FeedbackType[] = ["bug", "feature", "ui", "other"];

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  pending: "Pending",
  acknowledged: "Acknowledged",
  clarification_requested: "Clarification requested",
  resolved: "Resolved",
};

const STATUS_CLASSES: Record<FeedbackStatus, string> = {
  pending: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
  acknowledged: "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]",
  clarification_requested:
    "bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)]",
  resolved: "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]",
};

const schema = z.object({
  type: z.enum(["bug", "feature", "ui", "other"]),
  subject: z.string().min(1, "Subject is required").max(200),
  body: z.string().min(1, "Please describe what's happening").max(10_000),
});

type FormValues = z.infer<typeof schema>;

function StatusBadge({ status }: { status: FeedbackStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function TypeBadge({ type }: { type: FeedbackType }) {
  return (
    <span className="inline-flex items-center rounded-md border border-[var(--color-border)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted-foreground)]">
      {TYPE_LABELS[type]}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function FeedbackCard({ row }: { row: FeedbackRow }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <TypeBadge type={row.type} />
              <StatusBadge status={row.status} />
            </div>
            <CardTitle className="truncate text-base">{row.subject}</CardTitle>
            <CardDescription>Submitted {formatDate(row.created_at)}</CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide" : "Show"}
          </Button>
        </div>
      </CardHeader>
      {expanded ? (
        <CardContent className="space-y-3 pt-0">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Your message
            </p>
            <p className="whitespace-pre-wrap text-sm">{row.body}</p>
          </div>
          {row.admin_note ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
                Admin response
              </p>
              <p className="whitespace-pre-wrap text-sm">{row.admin_note}</p>
            </div>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

export function FeedbackPage() {
  const listQ = useFeedback();
  const create = useCreateFeedback();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: "bug", subject: "", body: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values);
      toast({ title: "Thanks — feedback submitted" });
      form.reset({ type: values.type, subject: "", body: "" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not submit feedback",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  });

  const rows = listQ.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Feedback</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Report bugs, suggest features, or tell us what's working. The
          Fratelli team reviews every submission and replies here.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Submit feedback</CardTitle>
          <CardDescription>
            Be specific — steps to reproduce, screenshots described in text, or
            the outcome you want.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="feedback-type">Type</Label>
              <select
                id="feedback-type"
                className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 py-1 text-sm text-[var(--color-foreground)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                {...form.register("type")}
              >
                {TYPE_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {TYPE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="feedback-subject">Subject</Label>
              <Input
                id="feedback-subject"
                placeholder="Short summary"
                maxLength={200}
                {...form.register("subject")}
              />
              {form.formState.errors.subject ? (
                <p className="text-xs text-[var(--color-destructive)]">
                  {form.formState.errors.subject.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="feedback-body">Details</Label>
              <Textarea
                id="feedback-body"
                rows={5}
                placeholder="What happened? What did you expect?"
                {...form.register("body")}
              />
              {form.formState.errors.body ? (
                <p className="text-xs text-[var(--color-destructive)]">
                  {form.formState.errors.body.message}
                </p>
              ) : null}
            </div>

            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Submitting…" : "Submit feedback"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">My submissions</h2>
        {listQ.isLoading ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
        ) : listQ.error ? (
          <Card>
            <CardContent className="p-6 text-sm text-[var(--color-destructive)]">
              {listQ.error instanceof ApiError
                ? listQ.error.message
                : "Failed to load feedback"}
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-[var(--color-muted-foreground)]">
              No feedback submitted yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {rows.map((row) => (
              <FeedbackCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
