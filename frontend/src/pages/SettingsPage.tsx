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
import { TutorialStartButton } from "@/components/TutorialStartButton";
import { useMe, useUpdateMe } from "@/hooks/use-me";
import { useToast } from "@/hooks/use-toast";
import { useTutorial } from "@/hooks/use-tutorial";
import { ApiError } from "@/lib/api";
import { formatCentsAsDollars, parseDollarsToCents } from "@/lib/utils";

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
