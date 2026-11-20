import { siteConfig } from "@/config/site";

export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid size-10 place-items-center rounded-xl bg-gradient-to-br from-sky-brand to-navy-600 shadow-lg shadow-sky-brand/20 ring-1 ring-white/15">
        <svg viewBox="0 0 24 24" className="size-5 text-white" fill="currentColor" aria-hidden="true">
          <path d="M21.5 3.2c-.6-.6-1.9-.3-3.2.9l-3.6 3.5-9.2-2.1-1.6 1.6 7.4 4-3.4 3.4-2.6-.4-1.3 1.3 3.3 1.6 1.6 3.3 1.3-1.3-.4-2.6 3.4-3.4 4 7.4 1.6-1.6-2.1-9.2 3.5-3.6c1.2-1.3 1.5-2.6.9-3.2Z" />
        </svg>
        <span className="absolute -right-1 -top-1 size-3 rounded-full bg-gold-500 ring-2 ring-navy-950" />
      </div>
      <div className="leading-tight">
        <p className="text-lg font-bold tracking-[0.18em] text-white">{siteConfig.name}</p>
        <p className="text-[11px] font-medium uppercase tracking-wider text-gold-300">{siteConfig.tagline}</p>
      </div>
    </div>
  );
}
