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
import { Button } from "@/components/ui/button";
import { useAuthorizeStripe } from "@/hooks/use-oauth";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api";

export function IntegrationsPage() {
  const authorize = useAuthorizeStripe();
  const [searchParams, setSearchParams] = useSearchParams();
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

  const handleConnect = async () => {
    try {
      const res = await authorize.mutateAsync();
      window.location.href = res.url;
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not start Stripe OAuth",
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
              <CardTitle>Stripe</CardTitle>
              <CardDescription>
                Collect payments and issue hosted invoices via Stripe Connect.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button onClick={handleConnect} disabled={authorize.isPending}>
            {authorize.isPending ? "Redirecting…" : "Connect Stripe"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
