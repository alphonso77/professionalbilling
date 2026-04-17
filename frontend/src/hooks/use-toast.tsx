import * as React from "react";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  type ToastProps,
} from "@/components/ui/toast";

type ToastItem = {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastProps["variant"];
  duration?: number;
};

type ToastContextValue = {
  toast: (t: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastContextProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const toast = React.useCallback((t: Omit<ToastItem, "id">) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...t, id }]);
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = React.useMemo<ToastContextValue>(
    () => ({ toast, dismiss }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastProvider swipeDirection="right">
        {children}
        {toasts.map((t) => (
          <Toast
            key={t.id}
            variant={t.variant}
            duration={t.duration ?? 5000}
            onOpenChange={(open) => {
              if (!open) dismiss(t.id);
            }}
          >
            <div className="flex flex-col gap-1">
              {t.title ? <ToastTitle>{t.title}</ToastTitle> : null}
              {t.description ? (
                <ToastDescription>{t.description}</ToastDescription>
              ) : null}
            </div>
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastContextProvider>");
  return ctx;
}
