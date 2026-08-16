"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  CloseIcon,
} from "@/components/icons";

type ToastVariant = "success" | "error";

type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  showToast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 3500;

// Fixed, theme-independent colors -- a toast is an assertive, momentary
// notification, not page chrome, so it stays the same vivid color in light
// and dark mode rather than adapting to either.
const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: "bg-green-600 ring-green-400/40",
  error: "bg-red-600 ring-red-400/40",
};

const VARIANT_ICONS: Record<ToastVariant, typeof CheckCircleIcon> = {
  success: CheckCircleIcon,
  error: AlertCircleIcon,
};

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  // A missing provider is a real bug, but toasts are non-critical UI --
  // fail soft (no-op) instead of throwing and breaking the save/upload flow
  // that triggered it.
  return (
    context ?? {
      showToast: () => {},
    }
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
    },
    [dismissToast],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col items-end gap-2"
      >
        {toasts.map((toast) => {
          const Icon = VARIANT_ICONS[toast.variant];
          return (
            <div
              key={toast.id}
              role="status"
              className={`pointer-events-auto flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-lg ring-1 ${VARIANT_STYLES[toast.variant]}`}
            >
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-white/25">
                <Icon className="h-4 w-4 text-white" />
              </span>
              <span className="flex-1">{toast.message}</span>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss"
                className="flex-none rounded p-1 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
