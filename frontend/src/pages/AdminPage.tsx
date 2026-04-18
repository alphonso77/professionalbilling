import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAdminUsers, useUpdateAdminUser } from "@/hooks/use-admin";
import {
  useAdminFeedback,
  useUpdateAdminFeedback,
} from "@/hooks/use-feedback";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api";
import type {
  AdminUserRow,
  FeedbackRow,
  FeedbackStatus,
  FeedbackType,
  UpdateAdminUserInput,
} from "@/types/api";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

// ------- Users tab (lifted from the former AdminUsersPage) -------

function ToggleSwitch({
  id,
  checked,
  onChange,
  disabled,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex items-center gap-2 text-sm cursor-pointer select-none"
    >
      <input
        id={id}
        type="checkbox"
        className="h-4 w-4 accent-[var(--color-primary)] disabled:opacity-50"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={disabled ? "text-[var(--color-muted-foreground)]" : undefined}>
        {label}
      </span>
    </label>
  );
}

function UsersTab() {
  const usersQ = useAdminUsers();
  const updateUser = useUpdateAdminUser();
  const { toast } = useToast();

  const onToggle = async (user: AdminUserRow, patch: UpdateAdminUserInput) => {
    try {
      await updateUser.mutateAsync({ id: user.id, patch });
      toast({ title: "User updated", description: user.email ?? user.id });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Unexpected error";
      toast({
        variant: "destructive",
        title: "Update failed",
        description: message,
      });
    }
  };

  if (usersQ.isLoading) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
    );
  }

  if (usersQ.error) {
    const message =
      usersQ.error instanceof ApiError
        ? usersQ.error.message
        : "Failed to load users";
    return (
      <Card>
        <CardContent className="p-6 text-sm text-[var(--color-destructive)]">
          {message}
        </CardContent>
      </Card>
    );
  }

  const users = usersQ.data ?? [];

  if (users.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-[var(--color-muted-foreground)]">
          No users yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {users.map((u) => (
        <Card key={u.id}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="truncate text-base">
                  {u.email ?? "(no email)"}
                </CardTitle>
                <CardDescription>
                  {u.role} · Joined {formatDate(u.created_at)}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <ToggleSwitch
                  id={`admin-${u.id}`}
                  label="Admin"
                  checked={u.is_admin}
                  disabled={updateUser.isPending}
                  onChange={(next) => onToggle(u, { is_admin: next })}
                />
                <ToggleSwitch
                  id={`egg-${u.id}`}
                  label="Easter egg"
                  checked={u.easter_egg_enabled}
                  disabled={updateUser.isPending}
                  onChange={(next) =>
                    onToggle(u, { easter_egg_enabled: next })
                  }
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0" />
        </Card>
      ))}
    </div>
  );
}

// ------- Feedback tab -------

const STATUS_OPTIONS: { value: FeedbackStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "clarification_requested", label: "Clarification requested" },
  { value: "resolved", label: "Resolved" },
];

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "Bug",
  feature: "Feature",
  ui: "UI / UX",
  other: "Other",
};

function FeedbackTriageRow({ row }: { row: FeedbackRow }) {
  const update = useUpdateAdminFeedback();
  const { toast } = useToast();
  const [note, setNote] = React.useState(row.admin_note ?? "");
  const [status, setStatus] = React.useState<FeedbackStatus>(row.status);

  React.useEffect(() => {
    setNote(row.admin_note ?? "");
    setStatus(row.status);
  }, [row.admin_note, row.status]);

  const dirty = note !== (row.admin_note ?? "") || status !== row.status;

  const onStatusChange = async (next: FeedbackStatus) => {
    setStatus(next);
    try {
      await update.mutateAsync({ id: row.id, patch: { status: next } });
      toast({ title: "Status updated", description: STATUS_OPTIONS.find((o) => o.value === next)?.label });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
      setStatus(row.status);
    }
  };

  const onSaveNote = async () => {
    try {
      await update.mutateAsync({
        id: row.id,
        patch: { admin_note: note.trim() === "" ? null : note },
      });
      toast({ title: "Note saved" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="truncate text-base">{row.subject}</CardTitle>
            <CardDescription>
              <span className="inline-flex items-center rounded-md border border-[var(--color-border)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted-foreground)] mr-2">
                {TYPE_LABELS[row.type]}
              </span>
              {row.submitter_email ?? "(unknown user)"} · {formatDateTime(row.created_at)}
            </CardDescription>
          </div>
          <select
            className="flex h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 py-1 text-sm text-[var(--color-foreground)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            value={status}
            disabled={update.isPending}
            onChange={(e) => onStatusChange(e.target.value as FeedbackStatus)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Message
          </p>
          <p className="whitespace-pre-wrap text-sm">{row.body}</p>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Admin note
          </p>
          <Textarea
            rows={3}
            value={note}
            placeholder="Visible to the submitter in their feedback list."
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={update.isPending || !dirty}
              onClick={() => {
                setNote(row.admin_note ?? "");
                setStatus(row.status);
              }}
            >
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={update.isPending || note === (row.admin_note ?? "")}
              onClick={onSaveNote}
            >
              {update.isPending ? "Saving…" : "Save note"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FeedbackTab() {
  const listQ = useAdminFeedback();

  if (listQ.isLoading) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
    );
  }
  if (listQ.error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-[var(--color-destructive)]">
          {listQ.error instanceof ApiError
            ? listQ.error.message
            : "Failed to load feedback"}
        </CardContent>
      </Card>
    );
  }
  const rows = listQ.data ?? [];
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-[var(--color-muted-foreground)]">
          No feedback yet.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-3">
      {rows.map((row) => (
        <FeedbackTriageRow key={row.id} row={row} />
      ))}
    </div>
  );
}

// ------- Tabbed page -------

type TabKey = "users" | "feedback";

export function AdminPage() {
  const [tab, setTab] = React.useState<TabKey>("users");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Manage users and triage feedback for your organization.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Admin sections"
        className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1"
      >
        <TabButton active={tab === "users"} onClick={() => setTab("users")}>
          Users
        </TabButton>
        <TabButton
          active={tab === "feedback"}
          onClick={() => setTab("feedback")}
        >
          Feedback
        </TabButton>
      </div>

      {tab === "users" ? <UsersTab /> : <FeedbackTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-sm px-3 text-sm font-medium transition-colors",
        active
          ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
          : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
      )}
    >
      {children}
    </button>
  );
}
