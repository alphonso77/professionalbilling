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
import {
  useAdminAllUsers,
  useAdminUsers,
  useUpdateAdminUser,
} from "@/hooks/use-admin";
import {
  useAdminFeedback,
  useUpdateAdminFeedback,
} from "@/hooks/use-feedback";
import {
  useAdminOfferCodes,
  useCreateOfferCode,
  useDeactivateOfferCode,
} from "@/hooks/use-offer-codes";
import { useMe } from "@/hooks/use-me";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api";
import type {
  AdminUserRow,
  AllUsersRow,
  FeedbackRow,
  FeedbackStatus,
  FeedbackType,
  OfferCodeRow,
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

// ------- All Users tab (super-admin only, cross-org read) -------

function AllUsersTab({ enabled }: { enabled: boolean }) {
  const listQ = useAdminAllUsers(enabled);

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
            : "Failed to load users"}
        </CardContent>
      </Card>
    );
  }
  const rows: AllUsersRow[] = listQ.data ?? [];
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-[var(--color-muted-foreground)]">
          No users yet.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Org</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2 text-left">Admin</th>
                <th className="px-4 py-2 text-left">Super-admin</th>
                <th className="px-4 py-2 text-left">Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-[var(--color-border)] last:border-b-0"
                >
                  <td className="px-4 py-2">{u.email ?? "(no email)"}</td>
                  <td className="px-4 py-2">{u.org_name ?? "—"}</td>
                  <td className="px-4 py-2">{u.role}</td>
                  <td className="px-4 py-2">{u.is_admin ? "Yes" : "—"}</td>
                  <td className="px-4 py-2">
                    {u.is_super_admin ? "Yes" : "—"}
                  </td>
                  <td className="px-4 py-2">{formatDate(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
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

  const noteDirty = note !== (row.admin_note ?? "");
  const statusDirty = status !== row.status;
  const dirty = noteDirty || statusDirty;

  const onSave = async () => {
    const patch: { status?: FeedbackStatus; admin_note?: string | null } = {};
    if (statusDirty) patch.status = status;
    if (noteDirty) patch.admin_note = note.trim() === "" ? null : note;
    if (Object.keys(patch).length === 0) return;
    try {
      await update.mutateAsync({ id: row.id, patch });
      toast({ title: "Feedback updated" });
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
              {row.submitter_email ?? "(unknown user)"}
              {row.org_name ? (
                <>
                  {" · "}
                  <span className="text-[var(--color-foreground)]">
                    {row.org_name}
                  </span>
                </>
              ) : null}
              {" · "}
              {formatDateTime(row.created_at)}
            </CardDescription>
          </div>
          <select
            className="flex h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 py-1 text-sm text-[var(--color-foreground)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            value={status}
            disabled={update.isPending}
            onChange={(e) => setStatus(e.target.value as FeedbackStatus)}
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
              disabled={update.isPending || !dirty}
              onClick={onSave}
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FeedbackTab({ enabled }: { enabled: boolean }) {
  const listQ = useAdminFeedback(enabled);

  if (!enabled) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-[var(--color-muted-foreground)]">
          Product feedback triage is restricted to Fratelli super-admins.
        </CardContent>
      </Card>
    );
  }

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

// ------- Offer Codes tab (super-admin only) -------

function formatRedemptions(row: OfferCodeRow): string {
  if (row.max_redemptions === null) {
    return `${row.redemption_count} / ∞`;
  }
  return `${row.redemption_count} / ${row.max_redemptions}`;
}

function codeStatus(row: OfferCodeRow): "active" | "inactive" | "exhausted" | "expired" {
  if (!row.active) return "inactive";
  if (
    row.max_redemptions !== null &&
    row.redemption_count >= row.max_redemptions
  ) {
    return "exhausted";
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return "expired";
  }
  return "active";
}

function OfferCodesTab({ enabled }: { enabled: boolean }) {
  const listQ = useAdminOfferCodes(enabled);
  const create = useCreateOfferCode();
  const deactivate = useDeactivateOfferCode();
  const { toast } = useToast();
  const [maxInput, setMaxInput] = React.useState<string>("");
  const [expiresInput, setExpiresInput] = React.useState<string>("");

  if (!enabled) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-[var(--color-muted-foreground)]">
          Offer codes are restricted to Fratelli super-admins.
        </CardContent>
      </Card>
    );
  }

  const onGenerate = async () => {
    const parsedMax =
      maxInput.trim() === "" ? null : Number.parseInt(maxInput, 10);
    if (parsedMax !== null && (!Number.isFinite(parsedMax) || parsedMax <= 0)) {
      toast({
        variant: "destructive",
        title: "Invalid max redemptions",
        description: "Leave blank for unlimited, or enter a positive integer.",
      });
      return;
    }
    const expires_at =
      expiresInput.trim() === ""
        ? null
        : new Date(expiresInput).toISOString();
    try {
      const row = await create.mutateAsync({
        max_redemptions: parsedMax,
        expires_at,
      });
      toast({
        title: "Code generated",
        description: `${row.code} — share with the customer.`,
      });
      setMaxInput("");
      setExpiresInput("");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Generate failed",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  const onDeactivate = async (row: OfferCodeRow) => {
    if (!window.confirm(`Deactivate code ${row.code}?`)) return;
    try {
      await deactivate.mutateAsync(row.id);
      toast({ title: "Code deactivated", description: row.code });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Deactivate failed",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  const rows = listQ.data ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate a code</CardTitle>
          <CardDescription>
            Random 6-digit code. Share with prospects who should get free
            signup access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
                Max redemptions
              </label>
              <input
                type="number"
                min={1}
                placeholder="Unlimited"
                value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 py-1 text-sm text-[var(--color-foreground)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
                Expires at (optional)
              </label>
              <input
                type="datetime-local"
                value={expiresInput}
                onChange={(e) => setExpiresInput(e.target.value)}
                className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 py-1 text-sm text-[var(--color-foreground)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              />
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={create.isPending}
            onClick={onGenerate}
          >
            {create.isPending ? "Generating…" : "Generate code"}
          </Button>
        </CardContent>
      </Card>

      {listQ.isLoading ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
      ) : listQ.error ? (
        <Card>
          <CardContent className="p-6 text-sm text-[var(--color-destructive)]">
            {listQ.error instanceof ApiError
              ? listQ.error.message
              : "Failed to load offer codes"}
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-[var(--color-muted-foreground)]">
            No codes yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="px-4 py-2 text-left">Code</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Redemptions</th>
                    <th className="px-4 py-2 text-left">Expires</th>
                    <th className="px-4 py-2 text-left">Created</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const status = codeStatus(row);
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-[var(--color-border)] last:border-b-0"
                      >
                        <td className="px-4 py-2 font-mono tracking-wider">
                          {row.code}
                        </td>
                        <td className="px-4 py-2 capitalize">{status}</td>
                        <td className="px-4 py-2">{formatRedemptions(row)}</td>
                        <td className="px-4 py-2">
                          {row.expires_at ? formatDateTime(row.expires_at) : "—"}
                        </td>
                        <td className="px-4 py-2">
                          {formatDateTime(row.created_at)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {row.active ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={deactivate.isPending}
                              onClick={() => onDeactivate(row)}
                            >
                              Deactivate
                            </Button>
                          ) : (
                            <span className="text-[var(--color-muted-foreground)]">
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ------- Tabbed page -------

type TabKey = "users" | "all-users" | "feedback" | "offer-codes";

export function AdminPage() {
  const meQ = useMe();
  const isSuperAdmin = meQ.data?.user?.is_super_admin === true;
  const [tab, setTab] = React.useState<TabKey>("users");

  React.useEffect(() => {
    if (
      !isSuperAdmin &&
      (tab === "all-users" || tab === "feedback" || tab === "offer-codes")
    ) {
      setTab("users");
    }
  }, [isSuperAdmin, tab]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Manage users in your organization
          {isSuperAdmin
            ? " — and triage product feedback across all orgs."
            : "."}
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
        {isSuperAdmin ? (
          <>
            <TabButton
              active={tab === "all-users"}
              onClick={() => setTab("all-users")}
            >
              All Users
            </TabButton>
            <TabButton
              active={tab === "feedback"}
              onClick={() => setTab("feedback")}
            >
              Feedback
            </TabButton>
            <TabButton
              active={tab === "offer-codes"}
              onClick={() => setTab("offer-codes")}
            >
              Offer Codes
            </TabButton>
          </>
        ) : null}
      </div>

      {tab === "users" ? (
        <UsersTab />
      ) : tab === "all-users" ? (
        <AllUsersTab enabled={isSuperAdmin} />
      ) : tab === "feedback" ? (
        <FeedbackTab enabled={isSuperAdmin} />
      ) : (
        <OfferCodesTab enabled={isSuperAdmin} />
      )}
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
