import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSignIn } from "@clerk/clerk-react";
import { Briefcase } from "lucide-react";
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

type Step = "email" | "code";

function extractClerkError(err: unknown): string {
  const e = err as { errors?: { longMessage?: string; message?: string }[] };
  return (
    e?.errors?.[0]?.longMessage ||
    e?.errors?.[0]?.message ||
    (err as Error)?.message ||
    "Something went wrong. Please try again."
  );
}

export function ActivatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isLoaded, signIn, setActive } = useSignIn();

  const [email, setEmail] = React.useState(searchParams.get("email") ?? "");
  const [code, setCode] = React.useState("");
  const [step, setStep] = React.useState<Step>("email");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!isLoaded || !signIn) return;
    setBusy(true);
    setError(null);
    try {
      await signIn.create({ identifier: email });
      const factor = signIn.supportedFirstFactors?.find(
        (f) => f.strategy === "email_code",
      );
      if (!factor || factor.strategy !== "email_code") {
        throw new Error(
          "This account can't sign in with an email code. Please contact support.",
        );
      }
      await signIn.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId: factor.emailAddressId,
      });
      setStep("code");
    } catch (err) {
      setError(extractClerkError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signIn) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "email_code",
        code,
      });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        navigate("/", { replace: true });
        return;
      }
      setError(`Unexpected sign-in state: ${result.status}`);
    } catch (err) {
      setError(extractClerkError(err));
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
        <Card>
          <CardHeader>
            <CardTitle>Activate your account</CardTitle>
            <CardDescription>
              {step === "email"
                ? "Enter the email you used at checkout. We'll send a 6-digit code."
                : `We sent a 6-digit code to ${email}. Enter it below.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === "email" ? (
              <form onSubmit={sendCode} className="space-y-4">
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
                  disabled={busy || !email || !isLoaded}
                  className="w-full"
                >
                  {busy ? "Sending…" : "Send me a code"}
                </Button>
              </form>
            ) : (
              <form onSubmit={verifyCode} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="code">6-digit code</Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
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
                {error ? (
                  <p className="text-sm text-[var(--color-destructive)]">
                    {error}
                  </p>
                ) : null}
                <Button
                  type="submit"
                  disabled={busy || code.length !== 6 || !isLoaded}
                  className="w-full"
                >
                  {busy ? "Verifying…" : "Verify and sign in"}
                </Button>
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("email");
                      setCode("");
                      setError(null);
                    }}
                    className="text-[var(--color-muted-foreground)] hover:underline"
                  >
                    Use a different email
                  </button>
                  <button
                    type="button"
                    onClick={() => sendCode()}
                    disabled={busy}
                    className="text-[var(--color-primary)] hover:underline"
                  >
                    Resend code
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
