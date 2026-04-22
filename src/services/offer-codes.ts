import crypto from 'node:crypto';
import type { Knex } from 'knex';
import type { ClerkClient } from '@clerk/backend';

import { db } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { getClerkClient } from './clerk-provisioning';
import { AppError } from '../middleware/error-handler';

export interface OfferCodeRow {
  id: string;
  code: string;
  max_redemptions: number | null;
  redemption_count: number;
  expires_at: string | null;
  active: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
}

/**
 * Generate a 6-digit numeric code (zero-padded). `000000`–`999999`.
 */
export function randomCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Insert a new code. Retries on collision up to `maxAttempts` times, which
 * is more than sufficient given the 1M keyspace + typical fill rate.
 */
export async function createOfferCode(
  input: {
    max_redemptions?: number | null;
    expires_at?: string | null;
    created_by_user_id?: string | null;
  },
  database: Knex = db,
  generate: () => string = randomCode,
  maxAttempts = 10
): Promise<OfferCodeRow> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const code = generate();
    try {
      const rows = await database('corporate.offer_codes')
        .insert({
          code,
          max_redemptions: input.max_redemptions ?? null,
          expires_at: input.expires_at ?? null,
          created_by_user_id: input.created_by_user_id ?? null,
        })
        .returning('*');
      return rows[0] as OfferCodeRow;
    } catch (err) {
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23505' && attempt < maxAttempts) {
        logger.warn('offer-codes: code collision, retrying', { attempt });
        continue;
      }
      throw err;
    }
  }
  throw new AppError(500, 'Could not generate a unique code', 'CODE_GENERATION_FAILED');
}

export async function deactivateOfferCode(
  id: string,
  database: Knex = db
): Promise<OfferCodeRow | null> {
  const rows = await database('corporate.offer_codes')
    .where({ id })
    .update({ active: false, deactivated_at: database.fn.now() })
    .returning('*');
  return (rows[0] as OfferCodeRow) ?? null;
}

export interface RedeemInput {
  code: string;
  email: string;
  ip: string | null;
}

export interface RedeemResult {
  invitationId: string;
}

/**
 * Redeem a code: lock the row, validate, send a Clerk invitation, bump
 * the counter, log the redemption. All inside a single transaction so a
 * parallel burst can't over-redeem past `max_redemptions` (`SELECT … FOR UPDATE`
 * serialises on the code row).
 *
 * Counter increments when the invitation is *sent*, not on later user-
 * complete. That's deliberate — it caps abuse of the public endpoint
 * even when the invitee never finishes signup.
 */
export async function redeemOfferCode(
  input: RedeemInput,
  database: Knex = db,
  clerk: ClerkClient = getClerkClient()
): Promise<RedeemResult> {
  const normalizedEmail = input.email.trim().toLowerCase();

  return database.transaction(async (trx) => {
    const row = (await trx('corporate.offer_codes')
      .where({ code: input.code })
      .forUpdate()
      .first()) as OfferCodeRow | undefined;

    if (!row || !row.active) {
      throw new AppError(400, 'Invalid offer code', 'INVALID_CODE');
    }
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      throw new AppError(400, 'Invalid offer code', 'INVALID_CODE');
    }
    if (row.max_redemptions !== null && row.redemption_count >= row.max_redemptions) {
      throw new AppError(400, 'Invalid offer code', 'INVALID_CODE');
    }

    const invitation = await clerk.invitations.createInvitation({
      emailAddress: normalizedEmail,
      redirectUrl: `${env.FRONTEND_URL}/sign-up/accept`,
      ignoreExisting: true,
      notify: true,
      publicMetadata: {
        offerCodeId: row.id,
        source: 'offer-code',
      },
    });

    await trx('corporate.offer_codes')
      .where({ id: row.id })
      .update({
        redemption_count: trx.raw('redemption_count + 1'),
      });

    await trx('corporate.offer_code_redemptions').insert({
      offer_code_id: row.id,
      email: normalizedEmail,
      clerk_invitation_id: invitation.id,
      ip: input.ip,
    });

    logger.info('offer-code redeemed', {
      offerCodeId: row.id,
      email: normalizedEmail,
      invitationId: invitation.id,
    });

    return { invitationId: invitation.id };
  });
}
