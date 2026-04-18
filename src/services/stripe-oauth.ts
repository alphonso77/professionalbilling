import axios, { AxiosError } from 'axios';
import { env } from '../config/env';

export interface DeauthorizeOpts {
  stripeUserId: string;
}

export interface DeauthorizeResult {
  deauthorized: true;
  alreadyRevoked?: boolean;
}

const DEAUTHORIZE_URL = 'https://connect.stripe.com/oauth/deauthorize';
const TIMEOUT_MS = 10_000;

export async function deauthorizeStripeAccount(opts: DeauthorizeOpts): Promise<DeauthorizeResult> {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  if (!env.STRIPE_CLIENT_ID) {
    throw new Error('STRIPE_CLIENT_ID is not configured');
  }

  const body = new URLSearchParams({
    client_id: env.STRIPE_CLIENT_ID,
    stripe_user_id: opts.stripeUserId,
  });

  try {
    await axios.post(DEAUTHORIZE_URL, body.toString(), {
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: TIMEOUT_MS,
    });
    return { deauthorized: true };
  } catch (err) {
    const axiosErr = err as AxiosError<{ error?: string; error_description?: string }>;
    const code = axiosErr.response?.data?.error;
    if (code === 'invalid_client' || code === 'account_not_connected') {
      return { deauthorized: true, alreadyRevoked: true };
    }
    throw err;
  }
}
