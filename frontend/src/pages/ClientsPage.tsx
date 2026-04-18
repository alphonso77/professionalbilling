import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useClients,
  useCreateClient,
  useDeleteClient,
  useUpdateClient,
} from "@/hooks/use-clients";
import { useArSettings } from "@/hooks/use-ar-settings";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api";
import {
  centsToCurrency,
  formatCentsAsDollars,
  parseDollarsToCents,
} from "@/lib/utils";
import type { Client, UpdateClientInput } from "@/types/api";

const rateDollarsField = z
  .string()
  .optional()
  .refine(
    (v) => v == null || v === "" || /^\d+(\.\d{0,2})?$/.test(v.trim()),
    "Enter a dollar amount like 150.00",
  );

const createClientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  billing_address: z.string().optional(),
  notes: z.string().optional(),
  default_rate_dollars: rateDollarsField,
});

const triState = z.enum(["inherit", "on", "off"]);

const editClientSchema = createClientSchema.extend({
  arAutomationEnabled: triState,
  arApprovalRequired: triState,
  arRemindersEnabled: triState,
  arReminderCadenceDays: z
    .string()
    .refine(
      (v) => v === "" || /^\d+$/.test(v.trim()),
      "Enter a positive whole number or leave blank to inherit",
    ),
});

type CreateClientFormValues = z.infer<typeof createClientSchema>;
type EditClientFormValues = z.infer<typeof editClientSchema>;

function boolToTri(v: boolean | null | undefined): "inherit" | "on" | "off" {
  if (v == null) return "inherit";
  return v ? "on" : "off";
}

function triToBool(v: "inherit" | "on" | "off"): boolean | null {
  if (v === "inherit") return null;
  return v === "on";
}

function rateInputFromCents(cents: number | null | undefined): string {
  if (cents == null) return "";
  return formatCentsAsDollars(cents);
}

function rateInputToCents(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return parseDollarsToCents(trimmed);
}

export function ClientsPage() {
  const clientsQ = useClients();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const arSettingsQ = useArSettings();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Client | null>(null);
  const showOverrides = arSettingsQ.data?.scope === "per_client";

  const form = useForm<CreateClientFormValues>({
    resolver: zodResolver(createClientSchema),
    defaultValues: {
      name: "",
      email: "",
      billing_address: "",
      notes: "",
      default_rate_dollars: "",
    },
  });

  const editForm = useForm<EditClientFormValues>({
    resolver: zodResolver(editClientSchema),
    defaultValues: {
      name: "",
      email: "",
      billing_address: "",
      notes: "",
      default_rate_dollars: "",
      arAutomationEnabled: "inherit",
      arApprovalRequired: "inherit",
      arRemindersEnabled: "inherit",
      arReminderCadenceDays: "",
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await createClient.mutateAsync({
        name: values.name,
        email: values.email || undefined,
        billing_address: values.billing_address || undefined,
        notes: values.notes || undefined,
        default_rate_cents: rateInputToCents(values.default_rate_dollars),
      });
      toast({ title: "Client created", description: values.name });
      form.reset();
      setOpen(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not create client",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  });

  const openEdit = (c: Client) => {
    editForm.reset({
      name: c.name,
      email: c.email ?? "",
      billing_address: c.billing_address ?? "",
      notes: c.notes ?? "",
      default_rate_dollars: rateInputFromCents(c.default_rate_cents),
      arAutomationEnabled: boolToTri(c.arAutomationEnabled),
      arApprovalRequired: boolToTri(c.arApprovalRequired),
      arRemindersEnabled: boolToTri(c.arRemindersEnabled),
      arReminderCadenceDays:
        c.arReminderCadenceDays == null ? "" : String(c.arReminderCadenceDays),
    });
    setEditing(c);
  };

  const onEditSubmit = editForm.handleSubmit(async (values) => {
    if (!editing) return;
    const patch: UpdateClientInput = {
      name: values.name,
      email: values.email ? values.email : null,
      billing_address: values.billing_address ? values.billing_address : null,
      notes: values.notes ? values.notes : null,
      default_rate_cents: rateInputToCents(values.default_rate_dollars),
    };
    if (showOverrides) {
      patch.arAutomationEnabled = triToBool(values.arAutomationEnabled);
      patch.arApprovalRequired = triToBool(values.arApprovalRequired);
      patch.arRemindersEnabled = triToBool(values.arRemindersEnabled);
      const cadence = values.arReminderCadenceDays.trim();
      patch.arReminderCadenceDays = cadence === "" ? null : Number(cadence);
    }
    try {
      await updateClient.mutateAsync({ id: editing.id, patch });
      toast({ title: "Client updated", description: values.name });
      setEditing(null);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  });

  const handleDelete = async (id: string, name: string) => {
    try {
      await deleteClient.mutateAsync(id);
      toast({ title: "Client deleted", description: name });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Manage the people and companies you bill.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" /> New client
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New client</DialogTitle>
              <DialogDescription>
                Add a client to assign time entries to.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" {...form.register("name")} autoFocus />
                {form.formState.errors.name ? (
                  <p className="text-xs text-[var(--color-destructive)]">
                    {form.formState.errors.name.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...form.register("email")} />
                {form.formState.errors.email ? (
                  <p className="text-xs text-[var(--color-destructive)]">
                    {form.formState.errors.email.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="default_rate_dollars">Default hourly rate</Label>
                <Input
                  id="default_rate_dollars"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="200.00"
                  {...form.register("default_rate_dollars")}
                />
                {form.formState.errors.default_rate_dollars ? (
                  <p className="text-xs text-[var(--color-destructive)]">
                    {form.formState.errors.default_rate_dollars.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="billing_address">Billing address</Label>
                <Textarea id="billing_address" rows={2} {...form.register("billing_address")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" rows={2} {...form.register("notes")} />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createClient.isPending}>
                  {createClient.isPending ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit client</DialogTitle>
            <DialogDescription>Update client details.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onEditSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit_name">Name</Label>
              <Input id="edit_name" {...editForm.register("name")} autoFocus />
              {editForm.formState.errors.name ? (
                <p className="text-xs text-[var(--color-destructive)]">
                  {editForm.formState.errors.name.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit_email">Email</Label>
              <Input
                id="edit_email"
                type="email"
                {...editForm.register("email")}
              />
              {editForm.formState.errors.email ? (
                <p className="text-xs text-[var(--color-destructive)]">
                  {editForm.formState.errors.email.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit_rate">Default hourly rate</Label>
              <Input
                id="edit_rate"
                type="number"
                step="0.01"
                min="0"
                placeholder="200.00"
                {...editForm.register("default_rate_dollars")}
              />
              {editForm.formState.errors.default_rate_dollars ? (
                <p className="text-xs text-[var(--color-destructive)]">
                  {editForm.formState.errors.default_rate_dollars.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit_billing">Billing address</Label>
              <Textarea
                id="edit_billing"
                rows={2}
                {...editForm.register("billing_address")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit_notes">Notes</Label>
              <Textarea id="edit_notes" rows={2} {...editForm.register("notes")} />
            </div>
            {showOverrides ? (
              <div className="space-y-3 rounded-md border border-[var(--color-border)] p-3">
                <div>
                  <p className="text-sm font-medium">
                    AR automation overrides
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Leave fields set to “Inherit” to use the org default.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TriStateField
                    id="edit_ar_enabled"
                    label="Automation enabled"
                    {...editForm.register("arAutomationEnabled")}
                  />
                  <TriStateField
                    id="edit_ar_approval"
                    label="Approval required"
                    {...editForm.register("arApprovalRequired")}
                  />
                  <TriStateField
                    id="edit_ar_reminders"
                    label="Reminders enabled"
                    {...editForm.register("arRemindersEnabled")}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="edit_ar_cadence">
                      Reminder cadence (days)
                    </Label>
                    <Input
                      id="edit_ar_cadence"
                      type="number"
                      min={1}
                      step={1}
                      placeholder="Inherit"
                      {...editForm.register("arReminderCadenceDays")}
                    />
                    {editForm.formState.errors.arReminderCadenceDays ? (
                      <p className="text-xs text-[var(--color-destructive)]">
                        {editForm.formState.errors.arReminderCadenceDays.message}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateClient.isPending}>
                {updateClient.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {clientsQ.isLoading ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
      ) : clientsQ.data && clientsQ.data.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {clientsQ.data.map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{c.name}</CardTitle>
                    <CardDescription className="truncate">
                      {c.email ?? "No email"}
                    </CardDescription>
                    {c.default_rate_cents != null ? (
                      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                        Default rate: {centsToCurrency(c.default_rate_cents)}/hr
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${c.name}`}
                      onClick={() => openEdit(c)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${c.name}`}
                      onClick={() => handleDelete(c.id, c.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {c.notes ? (
                <CardContent className="pt-0">
                  <p className="text-sm text-[var(--color-muted-foreground)] line-clamp-2">
                    {c.notes}
                  </p>
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 p-10 text-center">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              No clients yet. Add one to start assigning time entries.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type TriStateFieldProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  label: string;
};

const TriStateField = React.forwardRef<HTMLSelectElement, TriStateFieldProps>(
  ({ id, label, className, ...rest }, ref) => {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <select
          id={id}
          ref={ref}
          {...rest}
          className={
            "flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 py-1 text-sm " +
            (className ?? "")
          }
        >
          <option value="inherit">Inherit from org default</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </div>
    );
  },
);
TriStateField.displayName = "TriStateField";
