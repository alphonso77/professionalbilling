import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAdminUsers, useUpdateAdminUser } from "@/hooks/use-admin";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api";
import type { AdminUserRow, UpdateAdminUserInput } from "@/types/api";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

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

export function AdminUsersPage() {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin · Users</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Grant admin access and enable hidden features for users in this org.
        </p>
      </div>

      {users.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-[var(--color-muted-foreground)]">
            No users yet.
          </CardContent>
        </Card>
      ) : (
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
                      onChange={(next) =>
                        onToggle(u, { is_admin: next })
                      }
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
      )}
    </div>
  );
}
