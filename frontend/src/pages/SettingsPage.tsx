import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { InfoBubble } from "@/components/InfoBubble";
import { TutorialStartButton } from "@/components/TutorialStartButton";
import { useMe, useUpdateMe } from "@/hooks/use-me";
import { useToast } from "@/hooks/use-toast";
import { useTutorial } from "@/hooks/use-tutorial";
import {
  useArPreview,
  useArSettings,
  useRunArNow,
  useUpdateArSettings,
} from "@/hooks/use-ar-settings";
import { ApiError } from "@/lib/api";
import {
  centsToCurrency,
  formatCentsAsDollars,
  parseDollarsToCents,
} from "@/lib/utils";
import type { UpdateArSettingsInput } from "@/types/api";

const settingsSchema = z.object({
  default_rate_dollars: z
    .string()
    .optional()
    .refine(
      (v) => v == null || v === "" || /^\d+(\.\d{0,2})?$/.test(v.trim()),
      "Enter a dollar amount like 150.00",
    ),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

const arSchema = z.object({
  automationEnabled: z.boolean(),
  scope: z.enum(["global", "per_client"]),
  runDayOfMonth: z.coerce.number().int().min(1).max(28),
  approvalRequired: z.boolean(),
  remindersEnabled: z.boolean(),
  reminderCadenceDays: z.coerce.number().int().positive(),
});

type ArFormValues = z.infer<typeof arSchema>;

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function SettingsPage() {
  const meQ = useMe();
  const updateMe = useUpdateMe();
  const { toast } = useToast();
  const tutorial = useTutorial();
  const showTutorialCard =
    tutorial.state.hasCompletedTutorial && !tutorial.state.isActive;

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { default_rate_dollars: "" },
  });

  React.useEffect(() => {
    const cents = meQ.data?.user?.default_rate_cents;
    form.reset({
      default_rate_dollars: cents == null ? "" : formatCentsAsDollars(cents),
    });
  }, [meQ.data?.user?.default_rate_cents, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    const trimmed = values.default_rate_dollars?.trim() ?? "";
    const cents = trimmed ? parseDollarsToCents(trimmed) : null;
    try {
      await updateMe.mutateAsync({ default_rate_cents: cents });
      toast({ title: "Settings saved" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Personal preferences for your account.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Billing defaults</CardTitle>
          <CardDescription>
            Auto-populated on new time entries. A per-client rate takes
            precedence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="max-w-sm space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="default_rate_dollars">Default hourly rate</Label>
              <Input
                id="default_rate_dollars"
                type="number"
                step="0.01"
                min="0"
                placeholder="200.00"
                disabled={meQ.isLoading}
                {...form.register("default_rate_dollars")}
              />
              {form.formState.errors.default_rate_dollars ? (
                <p className="text-xs text-[var(--color-destructive)]">
                  {form.formState.errors.default_rate_dollars.message}
                </p>
              ) : null}
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Leave blank to clear.
              </p>
            </div>
            <Button type="submit" disabled={updateMe.isPending || meQ.isLoading}>
              {updateMe.isPending ? "Saving…" : "Save"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ArAutomationCard />

      {showTutorialCard ? (
        <Card>
          <CardHeader>
            <CardTitle>Help &amp; Onboarding</CardTitle>
            <CardDescription>
              Replay the welcome tour to refresh the app's main sections.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TutorialStartButton />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

const DEFAULT_AR: ArFormValues = {
  automationEnabled: false,
  scope: "global",
  runDayOfMonth: 1,
  approvalRequired: true,
  remindersEnabled: false,
  reminderCadenceDays: 30,
};

function ArAutomationCard() {
  const settingsQ = useArSettings();
  const updateSettings = useUpdateArSettings();
  const previewQ = useArPreview();
  const runNow = useRunArNow();
  const { toast } = useToast();

  const form = useForm<ArFormValues>({
    resolver: zodResolver(arSchema),
    defaultValues: DEFAULT_AR,
  });

  React.useEffect(() => {
    if (settingsQ.data) form.reset(settingsQ.data);
  }, [settingsQ.data, form]);

  const enabled = form.watch("automationEnabled");
  const remindersEnabled = form.watch("remindersEnabled");

  const onSubmit = form.handleSubmit(async (values) => {
    const patch: UpdateArSettingsInput = { ...values };
    try {
      await updateSettings.mutateAsync(patch);
      toast({ title: "AR automation saved" });
      form.reset(values);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  });

  const runNowConfirm = async () => {
    try {
      const res = await runNow.mutateAsync();
      const parts = [
        `${res.createdDrafts.length} draft${res.createdDrafts.length === 1 ? "" : "s"} created`,
        `${res.finalizedSent.length} invoice${res.finalizedSent.length === 1 ? "" : "s"} sent`,
        `${res.remindersSent.length} reminder${res.remindersSent.length === 1 ? "" : "s"} sent`,
      ];
      toast({ title: "AR run complete", description: parts.join(", ") });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Run failed",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  const preview = previewQ.data;
  const isDirty = form.formState.isDirty;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-1.5">
              Automate accounts receivable
              <InfoBubble entryKey="ar.automation.enabled" />
            </CardTitle>
            <CardDescription>
              Scheduled monthly billing from unbilled time entries, plus
              reminders on open invoices.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              id="ar_enabled"
              type="checkbox"
              className="h-4 w-4"
              {...form.register("automationEnabled")}
            />
            <Label htmlFor="ar_enabled" className="cursor-pointer">
              Enable AR automation
            </Label>
          </div>

          <fieldset
            disabled={!enabled}
            className="space-y-4 disabled:opacity-60"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label>Scope</Label>
                <InfoBubble entryKey="ar.automation.scope" />
              </div>
              <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-6">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="global"
                    className="h-4 w-4"
                    {...form.register("scope")}
                  />
                  Global (all clients)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="per_client"
                    className="h-4 w-4"
                    {...form.register("scope")}
                  />
                  Per-client (overrides allowed)
                </label>
              </div>
            </div>

            <div className="grid max-w-md gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="ar_run_day">Run day of month</Label>
                  <InfoBubble entryKey="ar.automation.run_day" />
                </div>
                <Input
                  id="ar_run_day"
                  type="number"
                  min={1}
                  max={28}
                  step={1}
                  {...form.register("runDayOfMonth")}
                />
                {form.formState.errors.runDayOfMonth ? (
                  <p className="text-xs text-[var(--color-destructive)]">
                    Enter a day between 1 and 28.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="ar_approval"
                type="checkbox"
                className="h-4 w-4"
                {...form.register("approvalRequired")}
              />
              <Label htmlFor="ar_approval" className="cursor-pointer">
                Require approval before sending
              </Label>
              <InfoBubble entryKey="ar.automation.approval" />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="ar_reminders"
                type="checkbox"
                className="h-4 w-4"
                {...form.register("remindersEnabled")}
              />
              <Label htmlFor="ar_reminders" className="cursor-pointer">
                Send payment reminders
              </Label>
            </div>

            {remindersEnabled ? (
              <div className="grid max-w-md gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="ar_cadence">Reminder cadence (days)</Label>
                    <InfoBubble entryKey="ar.reminders.cadence" />
                  </div>
                  <Input
                    id="ar_cadence"
                    type="number"
                    min={1}
                    step={1}
                    {...form.register("reminderCadenceDays")}
                  />
                  {form.formState.errors.reminderCadenceDays ? (
                    <p className="text-xs text-[var(--color-destructive)]">
                      Enter a positive number of days.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </fieldset>

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              disabled={!isDirty || updateSettings.isPending}
            >
              {updateSettings.isPending ? "Saving…" : "Save"}
            </Button>
            {isDirty ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => settingsQ.data && form.reset(settingsQ.data)}
                disabled={updateSettings.isPending}
              >
                Discard
              </Button>
            ) : null}
          </div>
        </form>

        <div className="space-y-3 border-t border-[var(--color-border)] pt-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-medium">Preview</h3>
              <InfoBubble entryKey="ar.preview" />
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => previewQ.refetch()}
                disabled={previewQ.isFetching}
              >
                {previewQ.isFetching ? "Refreshing…" : "Refresh"}
              </Button>
              <InfoBubble entryKey="ar.run_now" />
              <RunNowButton
                onConfirm={runNowConfirm}
                isPending={runNow.isPending}
              />
            </div>
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Next scheduled run:{" "}
            <span className="font-medium text-[var(--color-foreground)]">
              {formatDate(preview?.scheduledRunDate)}
            </span>
          </p>
          <ArPreviewTables
            isLoading={previewQ.isLoading}
            preview={preview}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ArPreviewTables({
  isLoading,
  preview,
}: {
  isLoading: boolean;
  preview: import("@/types/api").ArPreview | undefined;
}) {
  if (isLoading) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
    );
  }
  if (!preview) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        Preview unavailable.
      </p>
    );
  }
  const nothing =
    preview.wouldCreate.length === 0 && preview.wouldRemind.length === 0;
  if (nothing) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        No drafts or reminders queued for the next run.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {preview.wouldCreate.length > 0 ? (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Drafts that would be created
          </h4>
          <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Client</th>
                  <th className="px-3 py-2 text-right font-medium">Entries</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {preview.wouldCreate.map((r) => (
                  <tr key={r.clientId}>
                    <td className="px-3 py-2">{r.clientName}</td>
                    <td className="px-3 py-2 text-right">
                      {r.timeEntryCount}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {centsToCurrency(r.totalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {preview.wouldRemind.length > 0 ? (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Reminders that would fire
          </h4>
          <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Invoice</th>
                  <th className="px-3 py-2 text-left font-medium">Client</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Days past issued
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Reminder #
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {preview.wouldRemind.map((r) => (
                  <tr key={r.invoiceId}>
                    <td className="px-3 py-2 font-medium">
                      {r.invoiceNumber ?? "—"}
                    </td>
                    <td className="px-3 py-2">{r.clientName}</td>
                    <td className="px-3 py-2 text-right">{r.daysPastIssue}</td>
                    <td className="px-3 py-2 text-right">{r.reminderNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RunNowButton({
  onConfirm,
  isPending,
}: {
  onConfirm: () => void | Promise<void>;
  isPending: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" disabled={isPending}>
          {isPending ? "Running…" : "Run now"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Run AR automation now?</AlertDialogTitle>
          <AlertDialogDescription>
            This creates drafts from unbilled time entries and fires reminders
            immediately, regardless of the scheduled run day. Real clients will
            receive email; demo / example.com clients will not.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]"
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
          >
            Run now
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

