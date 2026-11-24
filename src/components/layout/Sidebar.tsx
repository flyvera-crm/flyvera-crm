"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navSections } from "@/config/navigation";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/format";
import { useLeadList } from "@/lib/lead-store";
import { followUpsDue } from "@/lib/dashboard-metrics";
import { todayIso, useHydrated } from "@/lib/dates";
import { Logo } from "./Logo";

type SidebarProps = {
  open: boolean;
  onClose: () => void;
};

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  // Live badge: this user's open leads with a follow-up due today or overdue (after hydration, in their timezone).
  const leads = useLeadList();
  const hydrated = useHydrated();
  const followUps = hydrated ? followUpsDue(leads, todayIso()).length : 0;
  const badgeFor = (item: (typeof navSections)[number]["items"][number]) =>
    item.liveBadge === "leadFollowUps" ? (followUps > 0 ? String(followUps) : undefined) : item.badge;

  return (
    <>
      {/* Dark overlay behind the drawer on small screens */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-40 bg-navy-950/60 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-navy-950 text-navy-100 transition-transform duration-300 lg:translate-x-0",
          "bg-[radial-gradient(120%_60%_at_0%_0%,rgba(14,165,233,0.16),transparent_60%)]",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-20 items-center justify-between px-6">
          <Logo />
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-navy-200 hover:bg-white/10 lg:hidden"
            aria-label="Close menu"
          >
            <Icon name="close" />
          </button>
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-4 pb-6">
          {navSections.map((section) => (
            <div key={section.title} className="mt-5 first:mt-2">
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-navy-300/70">
                {section.title}
              </p>
              <ul className="space-y-1">
                {section.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                          active
                            ? "bg-gradient-to-r from-sky-brand/25 to-sky-brand/5 text-white"
                            : "text-navy-200 hover:bg-white/5 hover:text-white",
                        )}
                      >
                        {active && (
                          <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-gold-500" />
                        )}
                        <Icon
                          name={item.icon}
                          className={cn(active ? "text-sky-brand" : "text-navy-300 group-hover:text-sky-brand")}
                        />
                        <span className="flex-1">{item.label}</span>
                        {badgeFor(item) && (
                          <span
                            className="rounded-full bg-gold-500/15 px-2 py-0.5 text-[11px] font-semibold text-gold-300"
                            title={item.liveBadge === "leadFollowUps" ? "Lead follow-ups due today or overdue" : undefined}
                          >
                            {badgeFor(item)}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Upgrade / premium card */}
        <div className="m-4 rounded-2xl border border-gold-500/30 bg-gradient-to-br from-navy-800 to-navy-900 p-4">
          <div className="flex items-center gap-2 text-gold-300">
            <Icon name="crown" size={18} />
            <p className="text-sm font-semibold">FLYVERA Premium</p>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-navy-200">
            Live GDS fares, WhatsApp automation and AI itineraries — coming soon.
          </p>
        </div>
      </aside>
    </>
  );
}
