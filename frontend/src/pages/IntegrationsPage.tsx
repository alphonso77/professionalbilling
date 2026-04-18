import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { CreditCard } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useAuthorizeStripe,
  useDisconnectStripe,
  usePlatforms,
} from "@/hooks/use-oauth";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api";
import type { Platform } from "@/types/api";

export function IntegrationsPage() {
  const authorize = useAuthorizeStripe();
  const platformsQ = usePlatforms();
  const disconnect = useDisconnectStripe();
  const [searchParams, setSearchParams] = useSearchParams();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [redirecting, setRedirecting] = React.useState(false);
  const { toast } = useToast();

  React.useEffect(() => {
    if (searchParams.get("connected") === "stripe") {
      toast({
        variant: "success",
        title: "Stripe connected",
        description: "Your Stripe account is now linked.",
      });
      const next = new URLSearchParams(searchParams);
      next.delete("connected");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, toast]);

  const stripePlatform: Platform | undefined = platformsQ.data?.find(
    (p) => p.type === "stripe",
  );

  const handleConnect = async () => {
    try {
      const res = await authorize.mutateAsync();
      setRedirecting(true);
      window.location.href = res.url;
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not start Stripe OAuth",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  const handleDisconnect = async () => {
    if (!stripePlatform) return;
    try {
      await disconnect.mutateAsync(stripePlatform.id);
      toast({
        variant: "success",
        title: "Stripe disconnected.",
      });
      setConfirmOpen(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not disconnect Stripe",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Connect third-party services to power invoicing and alerts.
        </p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--color-accent)]">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>
                {stripePlatform ? "Connected to Stripe" : "Stripe"}
              </CardTitle>
              <CardDescription>
                Collect payments and issue hosted invoices via Stripe Connect.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {platformsQ.isLoading ? (
            <div className="h-9 w-40 animate-pulse rounded-md bg-[var(--color-accent)]" />
          ) : stripePlatform ? (
            <>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Account: {stripePlatform.external_account_id}
              </p>
              <Button
                variant="destructive"
                onClick={() => setConfirmOpen(true)}
                disabled={disconnect.isPending}
              >
                {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
              </Button>
            </>
          ) : (
            <Button
              onClick={handleConnect}
              disabled={authorize.isPending || redirecting}
            >
              {authorize.isPending || redirecting
                ? "Redirecting…"
                : "Connect Stripe"}
            </Button>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Stripe?</AlertDialogTitle>
            <AlertDialogDescription>
              New invoices will not be collectible until you reconnect.
              Existing invoices remain intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={disconnect.isPending}
              onClick={(e) => {
                e.preventDefault();
                handleDisconnect();
              }}
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
