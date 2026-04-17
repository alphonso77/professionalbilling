import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
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
import { useClients, useCreateClient, useDeleteClient } from "@/hooks/use-clients";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api";

const clientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z
    .string()
    .email("Invalid email")
    .optional()
    .or(z.literal("")),
  billing_address: z.string().optional(),
  notes: z.string().optional(),
});

type ClientFormValues = z.infer<typeof clientSchema>;

export function ClientsPage() {
  const clientsQ = useClients();
  const createClient = useCreateClient();
  const deleteClient = useDeleteClient();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: { name: "", email: "", billing_address: "", notes: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await createClient.mutateAsync({
        name: values.name,
        email: values.email || undefined,
        billing_address: values.billing_address || undefined,
        notes: values.notes || undefined,
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
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${c.name}`}
                    onClick={() => handleDelete(c.id, c.name)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
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
