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

const editClientSchema = createClientSchema;

type CreateClientFormValues = z.infer<typeof createClientSchema>;
type EditClientFormValues = z.infer<typeof editClientSchema>;

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
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Client | null>(null);

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
