import { SignUp } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { useTheme } from "@/providers/ThemeProvider";

export function SignUpPage() {
  const { resolvedTheme } = useTheme();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)] p-4">
      <SignUp
        appearance={{
          baseTheme: resolvedTheme === "dark" ? dark : undefined,
        }}
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
      />
    </div>
  );
}
