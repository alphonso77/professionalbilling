import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ClerkProvider } from "@clerk/clerk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/App";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { ToastContextProvider } from "@/hooks/use-toast";
import "@/index.css";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;

if (!PUBLISHABLE_KEY) {
  // Fail fast in dev so misconfiguration surfaces immediately.
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/sign-in">
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ToastContextProvider>
              <App />
            </ToastContextProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ClerkProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
