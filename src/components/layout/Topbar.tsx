import Link from "next/link";
import { Icon } from "@/components/icons";
import { signOut } from "@/lib/auth-actions";

/** The signed-in user, as shown in the top bar. */
export type TopbarUser = { name: string; email: string; initials: string; roleLabel: string };

type TopbarProps = {
  user: TopbarUser;
  onMenuClick: () => void;
};

export function Topbar({ user, onMenuClick }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-navy-100 bg-white/85 backdrop-blur-md">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          onClick={onMenuClick}
          className="-ml-1 rounded-lg p-2 text-navy-700 hover:bg-navy-50 lg:hidden"
          aria-label="Open menu"
        >
          <Icon name="menu" />
        </button>

        <label className="relative hidden max-w-md flex-1 sm:block">
          <span className="sr-only">Search</span>
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
          <input
            type="search"
            placeholder="Search customers, bookings, PNRs…"
            className="h-10 w-full rounded-xl border border-navy-100 bg-canvas pl-10 pr-3 text-sm text-navy-900 placeholder:text-navy-300 focus:border-sky-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-brand/15"
          />
        </label>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <button className="rounded-lg p-2 text-navy-500 hover:bg-navy-50 sm:hidden" aria-label="Search">
            <Icon name="search" />
          </button>
          <Link
            href="/bookings/new"
            className="hidden items-center gap-2 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-800 md:flex"
          >
            <Icon name="plus" size={16} className="text-gold-300" />
            New booking
          </Link>
          <button className="relative rounded-lg p-2 text-navy-500 hover:bg-navy-50" aria-label="Notifications">
            <Icon name="bell" />
            <span className="absolute right-2 top-2 size-2 rounded-full bg-gold-500 ring-2 ring-white" />
          </button>
          <div className="flex items-center gap-3 border-l border-navy-100 pl-3">
            <div
              className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-gold-300 to-gold-600 text-sm font-bold text-navy-950"
              title={user.email}
            >
              {user.initials}
            </div>
            <div className="hidden leading-tight lg:block">
              <p className="max-w-48 truncate text-sm font-semibold text-navy-900">{user.name}</p>
              <p className="text-xs text-navy-400">{user.roleLabel}</p>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg p-2 text-navy-500 hover:bg-navy-50 hover:text-navy-900"
                aria-label="Sign out"
                title="Sign out"
              >
                <Icon name="logout" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </header>
  );
}
