import type { AppRole } from "@/config/roles";

export type MemberStatus = "active" | "disabled";

/** One line of a member's access history (from the audit log). */
export type MemberEvent = { at: string; by: string; text: string; reason?: string };

export type TeamMember = {
  userId: string;
  name: string;
  /** Admins only (from the login system). */
  email?: string;
  role: AppRole;
  status: MemberStatus;
  joinedOn: string; // ISO date
  /** Admins only. null = has never signed in. */
  lastSignInAt?: string | null;
  teams: { id: string; name: string; isManager: boolean }[];
  /** Admins only, newest first. */
  history?: MemberEvent[];
};

export type InvitationStatus = "Pending" | "Expired" | "Accepted" | "Revoked";

export type Invitation = {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  teamName?: string;
  invitedBy: string;
  createdOn: string;
  expiresAt: string;
  lastSentAt?: string;
  sendCount: number;
  status: InvitationStatus;
};

export type TeamGroup = { id: string; name: string; members: { userId: string; name: string; isManager: boolean }[] };

export type TeamPageData = {
  me: string;
  isAdmin: boolean;
  members: TeamMember[];
  /** Admins only (empty otherwise). */
  invitations: Invitation[];
  teams: TeamGroup[];
};

/** Open work a person holds, which moves to a colleague when they're disabled. */
export type OpenWork = { customers: number; leads: number; quotations: number; bookings: number; tasks: number; conversations: number };
