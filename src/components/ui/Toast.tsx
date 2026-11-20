"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/format";

type ToastAction = { label: string; onClick: () => void };
type ToastInput = { message: ReactNode; action?: ToastAction; tone?: "success" | "info" };
type ToastState = ToastInput & { id: number };

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

/** Show a short message in the corner: `const showToast = useToast(); showToast({ message: "Saved" })` */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((t: ToastInput) => {
    setToast({ ...t, id: Date.now() });
    clearTimeout(timer.current);
    // Messages with a button stay a little longer so there's time to click.
    timer.current = setTimeout(() => setToast(null), t.action ? 9000 : 6000);
  }, []);

  const dismiss = useCallback(() => setToast(null), []);
  const value = useMemo(() => showToast, [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "fixed inset-x-4 bottom-4 z-[70] transition-all duration-300 sm:left-auto sm:right-6 sm:w-[26rem] print:hidden",
          toast ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
        )}
      >
        {toast && (
          <div className="flex items-start gap-3 rounded-2xl border border-gold-500/30 bg-navy-900 p-4 text-sm text-white shadow-2xl">
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-full",
                toast.tone === "info" ? "bg-sky-brand/20 text-sky-brand" : "bg-emerald-500/20 text-emerald-300",
              )}
            >
              <Icon name={toast.tone === "info" ? "arrowRight" : "check"} size={16} strokeWidth={2.5} />
            </span>
            <div className="flex-1 pt-1">
              <div>{toast.message}</div>
              {toast.action && (
                <button
                  onClick={() => {
                    toast.action?.onClick();
                    dismiss();
                  }}
                  className="mt-2.5 rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-navy-950 hover:bg-gold-400"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button onClick={dismiss} className="rounded-lg p-1 text-navy-300 hover:bg-white/10 hover:text-white" aria-label="Dismiss">
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
