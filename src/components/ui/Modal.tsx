"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/format";
import { useDialog } from "./use-dialog";

/** Small centred dialog for quick questions (e.g. "Why was this lead lost?"). */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useDialog(open, panelRef, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-end p-0 sm:place-items-center sm:p-4">
      <div onClick={close} className="absolute inset-0 bg-navy-950/50 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className={cn(
          "relative w-full rounded-t-3xl bg-white p-5 shadow-2xl outline-none sm:max-w-md sm:rounded-3xl sm:p-6",
        )}
      >
        <h2 id="modal-title" className="text-lg font-semibold text-navy-900">
          {title}
        </h2>
        {description && <div className="mt-1 text-sm text-navy-500">{description}</div>}
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
      </div>
    </div>
  );
}
