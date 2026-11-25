import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { getCurrentUser } from "@/lib/auth";
import { getAgencySettings, getMyProfile } from "@/lib/data/settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [user, settings, profile] = await Promise.all([getCurrentUser(), getAgencySettings(), getMyProfile()]);
  const isAdmin = user.membership?.role === "admin";
  return (
    <>
      <PageHeader
        eyebrow="Agency"
        title="Settings"
        description={
          isAdmin
            ? "Your agency's details on documents, bank details for invoices, and the defaults for new quotations and bookings."
            : "Your name and contact details in the CRM."
        }
      />
      <SettingsWorkspace settings={settings} profile={profile} isAdmin={isAdmin} />
    </>
  );
}
