import { SignIn } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { useTheme } from "@/providers/ThemeProvider";

export function SignInPage() {
  const { resolvedTheme } = useTheme();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)] p-4">
      <SignIn
        appearance={{
          baseTheme: resolvedTheme === "dark" ? dark : undefined,
        }}
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
      />
    </div>
  );
}
