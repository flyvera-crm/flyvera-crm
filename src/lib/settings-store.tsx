"use client";

// Agency settings for browser components (quote builder, documents, margins, supplier due dates).
// Loaded once on the server by the CRM layout. Outside the provider, the built-in defaults apply.
import { createContext, useContext, type ReactNode } from "react";
import { FALLBACK_SETTINGS, type AgencySettings } from "@/lib/settings-rules";

const SettingsContext = createContext<AgencySettings>(FALLBACK_SETTINGS);

export function SettingsProvider({ settings, children }: { settings: AgencySettings; children: ReactNode }) {
  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>;
}

export function useAgencySettings() {
  return useContext(SettingsContext);
}
