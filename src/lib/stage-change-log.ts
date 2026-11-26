// One diagnostic line per lead stage-change Server Action call, written to the server log
// (Hostinger: the Node.js app's runtime log). Pure, unit-tested.
// It contains ONLY a random request ID, the requested stage and the outcome. Never pass anything
// else through: no lead/user/organization IDs, names, phones, emails or other personal data.
// Every value is checked against a fixed list, so text from the browser is never copied into the log.
import { randomUUID } from "node:crypto";
import { LEAD_STAGES } from "@/config/lead-options";

export const STAGE_CHANGE_OUTCOMES = [
  "ok",
  "invalid-input",
  "no-membership",
  "not-found",
  "customer-not-found",
  "update-failed",
] as const;
export type StageChangeOutcome = (typeof STAGE_CHANGE_OUTCOMES)[number];

const STAGES: readonly string[] = LEAD_STAGES.map((s) => s.value);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A fresh random ID for one call (links a log line to one attempt; identifies nobody). */
export const newRequestId = () => randomUUID();

/** Only these three fields are read; anything else passed in is ignored. */
export function stageChangeLogLine({ requestId, stage, outcome }: { requestId: unknown; stage: unknown; outcome: unknown }) {
  const id = typeof requestId === "string" && UUID_RE.test(requestId) ? requestId : "invalid";
  const st = stage === undefined ? "none" : typeof stage === "string" && STAGES.includes(stage) ? stage : "invalid";
  const out = (STAGE_CHANGE_OUTCOMES as readonly unknown[]).includes(outcome) ? (outcome as string) : "unknown";
  return `lead-stage-change request=${id} stage=${st} outcome=${out}`;
}
