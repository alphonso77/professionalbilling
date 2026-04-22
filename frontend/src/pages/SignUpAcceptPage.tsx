import { SignUp } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { useTheme } from "@/providers/ThemeProvider";

/**
 * Landing page for Clerk invitation links. When users redeem an offer code
 * on /sign-up, we call `clerkClient.invitations.createInvitation` with
 * `redirectUrl: '${FRONTEND_URL}/sign-up/accept'`. Clerk emails them a link
 * like `/sign-up/accept?__clerk_ticket=...` — the <SignUp /> component
 * auto-detects the ticket from the URL and binds the signup to the
 * invitation.
 *
 * The Clerk dashboard's signup Restrictions must be set to "Restricted"
 * (invitation or allowlist required) so direct visits to this URL without
 * a ticket are rejected by Clerk itself.
 */
export function SignUpAcceptPage() {
  const { resolvedTheme } = useTheme();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)] p-4">
      <SignUp
        appearance={{
          baseTheme: resolvedTheme === "dark" ? dark : undefined,
        }}
        routing="path"
        path="/sign-up/accept"
        signInUrl="/sign-in"
      />
    </div>
  );
}
