"use client";

import { useRef, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/format";
import { useDialog } from "./use-dialog";

/**
 * Slide-in panel from the right (full screen on phones).
 * Closes on Esc / backdrop click, keeps keyboard focus inside while open,
 * and returns focus to whatever opened it.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useDialog(open, panelRef, onClose);

  return (
    <div className={cn("fixed inset-0 z-[60]", !open && "pointer-events-none")} inert={!open} aria-hidden={!open}>
      <div
        onClick={close}
        className={cn(
          "absolute inset-0 bg-navy-950/50 backdrop-blur-sm transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl outline-none transition-transform duration-300 ease-out sm:max-w-2xl",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="relative flex items-start justify-between gap-4 bg-navy-900 px-5 py-5 text-white sm:px-7">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_140%_at_100%_0%,rgba(14,165,233,0.3),transparent_60%)]" />
          <div className="relative min-w-0">
            <h2 id="drawer-title" className="text-lg font-semibold">
              {title}
            </h2>
            {description && <div className="mt-0.5 text-sm text-navy-200">{description}</div>}
          </div>
          <button
            type="button"
            onClick={close}
            className="relative rounded-lg p-1.5 text-navy-200 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <footer className="border-t border-navy-100 bg-white px-5 py-4 sm:px-7">{footer}</footer>}
      </div>
    </div>
  );
}
