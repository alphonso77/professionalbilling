import * as React from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";

type PaymentFormProps = {
  clientSecret: string;
  publishableKey: string;
  connectedAccountId: string;
  onSuccess?: () => void;
};

const stripeCache = new Map<string, Promise<Stripe | null>>();

function getStripe(publishableKey: string, connectedAccountId: string) {
  const key = `${publishableKey}::${connectedAccountId}`;
  let promise = stripeCache.get(key);
  if (!promise) {
    promise = loadStripe(publishableKey, { stripeAccount: connectedAccountId });
    stripeCache.set(key, promise);
  }
  return promise;
}

function InnerForm({ onSuccess }: { onSuccess?: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErrorMessage(null);

    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.set("paid", "1");

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl.toString() },
      redirect: "if_required",
    });

    if (error) {
      setErrorMessage(error.message ?? "Payment failed");
      setSubmitting(false);
      return;
    }

    if (paymentIntent?.status === "succeeded") {
      onSuccess?.();
    }
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {errorMessage ? (
        <p className="text-sm text-[var(--color-destructive)]">{errorMessage}</p>
      ) : null}
      <Button type="submit" disabled={!stripe || submitting} className="w-full">
        {submitting ? "Processing…" : "Pay now"}
      </Button>
    </form>
  );
}

export function PaymentForm({
  clientSecret,
  publishableKey,
  connectedAccountId,
  onSuccess,
}: PaymentFormProps) {
  const stripePromise = React.useMemo(
    () => getStripe(publishableKey, connectedAccountId),
    [publishableKey, connectedAccountId],
  );

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <InnerForm onSuccess={onSuccess} />
    </Elements>
  );
}
