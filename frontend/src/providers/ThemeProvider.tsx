import * as React from "react";

type ThemeMode = "light" | "dark" | "system";

type ThemeContextValue = {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (t: ThemeMode) => void;
};

const STORAGE_KEY = "pb_theme";

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

function systemPrefersDark() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyDocumentClass(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemeMode>(() =>
    readStoredTheme(),
  );
  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">(
    () => (readStoredTheme() === "dark" ? "dark" : readStoredTheme() === "light" ? "light" : systemPrefersDark() ? "dark" : "light"),
  );

  React.useEffect(() => {
    const resolved: "light" | "dark" =
      theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
    setResolvedTheme(resolved);
    applyDocumentClass(resolved);
  }, [theme]);

  React.useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const resolved: "light" | "dark" = media.matches ? "dark" : "light";
      setResolvedTheme(resolved);
      applyDocumentClass(resolved);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = React.useCallback((next: ThemeMode) => {
    setThemeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
