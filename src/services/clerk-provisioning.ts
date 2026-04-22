import { createClerkClient, type ClerkClient } from '@clerk/backend';

import { env } from '../config/env';
import { logger } from '../utils/logger';

let _clerk: ClerkClient | null = null;

export function getClerkClient(): ClerkClient {
  if (!_clerk) {
    if (!env.CLERK_SECRET_KEY) {
      throw new Error('CLERK_SECRET_KEY is not configured');
    }
    _clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  }
  return _clerk;
}

export interface ProvisionCustomerInput {
  email: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  trialEndAt: number | null;
}

export interface ProvisionCustomerResult {
  clerkUserId: string;
  clerkOrgId: string;
  reused: boolean;
}

/**
 * Derive a human-ish org name from an email address.
 * "alice@example.com" -> "alice's Organization".
 * The user can rename this at /settings after first sign-in.
 */
export function deriveOrgName(email: string): string {
  const local = email.split('@')[0] || 'my';
  return `${local}'s Organization`;
}

/**
 * Create the Clerk user + Clerk org for a marketing-site signup.
 *
 * Idempotent: if a Clerk user already exists for the email, we re-use the
 * first organization they belong to (the churned-and-returning-customer
 * case) and update its publicMetadata with the new Stripe ids. Otherwise
 * we mint a fresh user + org.
 *
 * Stripe ids land on the org's publicMetadata; our existing
 * `organization.created` webhook handler reads them and persists them to
 * the `organizations` row, so we don't need a second round-trip here.
 */
export async function provisionCustomer(
  input: ProvisionCustomerInput,
  client: ClerkClient = getClerkClient()
): Promise<ProvisionCustomerResult> {
  const { email, stripeCustomerId, stripeSubscriptionId, trialEndAt } = input;

  const publicMetadata = {
    stripeCustomerId,
    stripeSubscriptionId,
    trialEndAt,
    source: 'fratellisoftware-com',
  };

  const existing = await client.users.getUserList({ emailAddress: [email] });
  if (existing.totalCount > 0 && existing.data.length > 0) {
    const user = existing.data[0];
    const memberships = await client.users.getOrganizationMembershipList({
      userId: user.id,
    });
    if (memberships.data.length > 0) {
      const org = memberships.data[0].organization;
      await client.organizations.updateOrganizationMetadata(org.id, {
        publicMetadata,
      });
      logger.info('provisionCustomer: reused existing Clerk user + org', {
        clerkUserId: user.id,
        clerkOrgId: org.id,
        email,
      });
      return {
        clerkUserId: user.id,
        clerkOrgId: org.id,
        reused: true,
      };
    }

    const org = await client.organizations.createOrganization({
      name: deriveOrgName(email),
      createdBy: user.id,
      publicMetadata,
    });
    logger.info('provisionCustomer: created org for existing user', {
      clerkUserId: user.id,
      clerkOrgId: org.id,
      email,
    });
    return { clerkUserId: user.id, clerkOrgId: org.id, reused: true };
  }

  const user = await client.users.createUser({
    emailAddress: [email],
    skipPasswordRequirement: true,
    skipPasswordChecks: true,
  });

  const org = await client.organizations.createOrganization({
    name: deriveOrgName(email),
    createdBy: user.id,
    publicMetadata,
  });

  logger.info('provisionCustomer: created Clerk user + org', {
    clerkUserId: user.id,
    clerkOrgId: org.id,
    email,
  });

  return { clerkUserId: user.id, clerkOrgId: org.id, reused: false };
}
