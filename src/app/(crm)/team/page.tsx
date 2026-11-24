import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { TeamWorkspace } from "@/components/team/TeamWorkspace";
import { getTeamPage } from "@/lib/data/team";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const data = await getTeamPage();
  if (!data) {
    // Signed in, but not (or no longer) an active member of an agency.
    return <PageHeader eyebrow="Agency" title="Team" description="Your login has no agency access. Ask your agency admin for an invitation." />;
  }
  return (
    <>
      <PageHeader
        eyebrow="Agency"
        title="Team"
        description={
          data.isAdmin
            ? "Invite people, set their roles and teams, and disable access when someone leaves. Every change is logged with a reason."
            : "Who's who in the agency, their roles and teams."
        }
      />
      <TeamWorkspace data={data} />
    </>
  );
}
