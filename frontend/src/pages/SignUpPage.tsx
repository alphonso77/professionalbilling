import * as React from "react";
import { Briefcase, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redeemOfferCode } from "@/hooks/use-offer-codes";
import { ApiError } from "@/lib/api";

export function SignUpPage() {
  const [code, setCode] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await redeemOfferCode({ code, email: email.trim().toLowerCase() });
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-card)]/60 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4">
          <Briefcase className="h-5 w-5 text-[var(--color-primary)]" />
          <span className="font-semibold tracking-tight">
            Professional Billing
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-md p-6">
        {sent ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-5 w-5 text-[var(--color-primary)]" />
                Check your email
              </CardTitle>
              <CardDescription>
                We sent a signup link to <strong>{email}</strong>. Click it to
                finish creating your account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-[var(--color-muted-foreground)]">
                The link expires in a few days. If you don&apos;t see the
                email, check spam — or redeem a different code.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setSent(false);
                  setCode("");
                  setError(null);
                }}
              >
                Use another code
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Create your account</CardTitle>
              <CardDescription>
                Signup is invite-only. Enter your offer code and we&apos;ll email
                you a signup link.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Offer code</Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    autoComplete="off"
                    required
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="123456"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                {error ? (
                  <p className="text-sm text-[var(--color-destructive)]">
                    {error}
                  </p>
                ) : null}
                <Button
                  type="submit"
                  disabled={busy || code.length !== 6 || !email}
                  className="w-full"
                >
                  {busy ? "Sending…" : "Send me a signup link"}
                </Button>
              </form>
              <p className="mt-6 text-xs text-[var(--color-muted-foreground)]">
                Already paid for a subscription? Use the activation link from
                your welcome email, or visit{" "}
                <a className="underline" href="/activate">
                  /activate
                </a>
                .
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
