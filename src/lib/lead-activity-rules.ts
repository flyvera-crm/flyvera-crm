// Lead activity log: entry shape and validation (pure; shared by the lead panel, its Server Action and tests).

/** Types people log by hand. "Stage change" is written by the database; "Quotation" is reserved. */
export type LogType = "Call" | "WhatsApp" | "Email" | "Meeting" | "Note";
export const LOG_TYPES: LogType[] = ["Call", "WhatsApp", "Email", "Meeting", "Note"];
/** These count as contact with the lead (they update "Last contact"). */
export const CONTACT_TYPES: LogType[] = ["Call", "WhatsApp", "Email", "Meeting"];

export type LeadActivityEntry = {
  id: string;
  type: string; // LogType | "Stage change" | "Quotation"
  body?: string;
  fromStage?: string;
  toStage?: string;
  at: string; // ISO timestamp
  by: string;
};

export type ActivityValues = { type: LogType | ""; body: string; nextFollowUp: string };

export function validateActivity(v: ActivityValues, today: string) {
  const e: Partial<Record<keyof ActivityValues, string>> = {};
  if (!v.type || !LOG_TYPES.includes(v.type)) e.type = "Choose what happened.";
  const body = v.body.trim();
  if (body.length < 2) e.body = "Add a short note (what was said or agreed).";
  else if (body.length > 1000) e.body = "Keep it under 1000 characters.";
  if (v.nextFollowUp) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.nextFollowUp)) e.nextFollowUp = "Enter a date.";
    else if (v.nextFollowUp < today) e.nextFollowUp = "The next follow-up can't be in the past.";
  }
  return e;
}

/** One line for the log, e.g. "Moved from New to Contacted" or the note itself. */
export function describeActivity(a: LeadActivityEntry) {
  if (a.type === "Stage change") {
    const move = a.fromStage ? `Moved from ${a.fromStage} to ${a.toStage}` : `Moved to ${a.toStage}`;
    return a.body ? `${move} — ${a.body}` : move;
  }
  return a.body ?? "";
}
