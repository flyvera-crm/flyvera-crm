"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar, type TopbarUser } from "./Topbar";

// Wraps every CRM page: fixed sidebar on desktop, slide-in drawer on mobile.
export function AppShell({ user, children }: { user: TopbarUser; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <div className="print:hidden">
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      </div>
      <div className="lg:pl-72 print:pl-0">
        <div className="print:hidden">
          <Topbar user={user} onMenuClick={() => setMenuOpen(true)} />
        </div>
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">{children}</main>
      </div>
    </div>
  );
}
