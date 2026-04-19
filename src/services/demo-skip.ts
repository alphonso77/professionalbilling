/**
 * Shared demo-skip rule for outbound invoice email + reminders.
 *
 * Invoices are considered demo (and their emails suppressed) when:
 *   - the invoice row is seeded (`seeded_at IS NOT NULL`), OR
 *   - the recipient email lives on a reserved `example.{com,org,net}` domain
 *     (RFC 2606) — including nested subdomains like `foo.example.com`.
 *
 * Enforced at every send site so seeded/test data never reaches a real inbox.
 */

export const EXAMPLE_DOMAIN_RE = /@(?:[^@]+\.)?example(?:\.com|\.org|\.net)?$/i;

export type DemoSkipReason = 'seeded' | 'example_domain';

export function shouldSkipSend(args: {
  seededAt: string | Date | null | undefined;
  email: string | null | undefined;
}): { skip: boolean; reason: DemoSkipReason | null } {
  if (args.seededAt != null) return { skip: true, reason: 'seeded' };
  if (args.email && EXAMPLE_DOMAIN_RE.test(args.email)) {
    return { skip: true, reason: 'example_domain' };
  }
  return { skip: false, reason: null };
}
