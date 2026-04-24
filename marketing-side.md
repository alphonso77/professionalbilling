# `signup.completed` webhook → Professional Billing

Handoff from `fratellisoftware.com` to Professional Billing when a user finishes the Stripe signup (card attached, trial started). Fires once per subscription; idempotent on the sender side via Stripe subscription metadata.

## Delivery

- **Method**: `POST`
- **URL**: `PB_WEBHOOK_URL` (env var on the sender)
- **Content-Type**: `application/json`
- **Signature header**: `X-Fratelli-Signature: sha256=<hex-hmac-sha256(body, PB_WEBHOOK_SECRET)>`
  - HMAC is computed over the **exact raw request body** (no whitespace normalization).
  - The receiver should reject on mismatch.
- **Retries**: sender retries at 0ms, 500ms, 2000ms on network errors and 5xx. 4xx is treated as terminal — return 4xx only for genuinely unacceptable payloads (e.g. bad signature), return 2xx otherwise.

## Payload

```json
{
  "event": "signup.completed",
  "occurredAt": "2026-04-23T18:42:07.913Z",
  "email": "user@firm.com",
  "stripeCustomerId": "cus_ABC123",
  "stripeSubscriptionId": "sub_XYZ789",
  "trialEndAt": 1777939327000,
  "termsAccepted": true,
  "termsAcceptedAt": "2026-04-23T18:39:51.202Z",
  "termsVersion": "2026-04-23",
  "termsAcceptedIp": "203.0.113.42"
}
```

## Field reference

| Field | Type | Notes |
| --- | --- | --- |
| `event` | string | Always `"signup.completed"` for this payload. |
| `occurredAt` | ISO-8601 string | Server timestamp when the webhook fires (finalize → publish). |
| `email` | string \| null | Lowercased email the user signed up with. Sourced from Stripe customer, falling back to subscription metadata. |
| `stripeCustomerId` | string | Stripe customer id (`cus_...`). |
| `stripeSubscriptionId` | string | Stripe subscription id (`sub_...`). Use as the idempotency key on your side. |
| `trialEndAt` | number \| null | Unix epoch **milliseconds** when the free trial ends (Stripe's `trial_end * 1000`). `null` if somehow absent. |
| `termsAccepted` | boolean | Always `true` when this event fires — the server won't create a subscription without acceptance. Included so the field is explicit in your records. |
| `termsAcceptedAt` | ISO-8601 string \| null | When the user ticked the acceptance checkbox during signup. |
| `termsVersion` | string \| null | Version identifier of the terms the user accepted (currently `"2026-04-23"`). Bump when you publish new terms. |
| `termsAcceptedIp` | string \| null | Client IP at the moment of acceptance, as seen by the sender behind its proxy. May be IPv4 or IPv6. |

The `terms*` fields are new as of 2026-04-23. They will be `null` only if a subscription was somehow created before this code shipped and is being replayed — for new signups they are always populated.

## Receiver sketch (Node/Express)

```js
import crypto from 'node:crypto';

app.post('/webhooks/fratelli-signup',
  express.raw({ type: 'application/json' }), // raw body needed for HMAC
  (req, res) => {
    const sig = req.header('X-Fratelli-Signature') || '';
    const expected = 'sha256=' + crypto
      .createHmac('sha256', process.env.FRATELLI_WEBHOOK_SECRET)
      .update(req.body)
      .digest('hex');

    // constant-time compare
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'bad_signature' });
    }

    const payload = JSON.parse(req.body.toString('utf8'));
    if (payload.event !== 'signup.completed') {
      return res.status(202).end(); // unknown event, ack & drop
    }

    // Idempotency: key on stripeSubscriptionId
    // Store: email, stripeCustomerId, stripeSubscriptionId, trialEndAt,
    //        termsAccepted, termsAcceptedAt, termsVersion, termsAcceptedIp
    // Return 2xx promptly; do the heavier work async.
    res.status(200).json({ ok: true });
  }
);
```

## Record-keeping recommendation

Persist the four `terms*` fields alongside the subscription record on the PB side so you have a legally defensible trail independent of Stripe. `termsVersion` lets you reconcile what exact wording the user accepted when terms are updated later.
