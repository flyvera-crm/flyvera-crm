// What /api/build-info reports. Pure, unit-tested. No secrets: Server Action IDs are already public
// (the browser code contains them), and only a short hash of them is returned.
import { createHash } from "node:crypto";

export type BuildInfo = {
  buildId: string;
  /** Short hash of the Server Action IDs this server process has loaded. Same value = same IDs. */
  actionsFingerprint: string;
  /** When this server process started (tells separate processes apart). */
  processStartedAt: string;
};

/** Hash of the action IDs, independent of their order. "unavailable" if none could be read. */
export function actionsFingerprint(ids: readonly unknown[]): string {
  const valid = ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f]{40,}$/.test(id));
  if (valid.length === 0 || valid.length !== ids.length) return "unavailable";
  return createHash("sha256").update([...valid].sort().join("\n")).digest("hex").slice(0, 16);
}

/** The id Next.js gives a Server Action function on the server ($$id), if any. */
export function serverActionId(fn: unknown): unknown {
  return typeof fn === "function" ? (fn as { $$id?: unknown }).$$id : undefined;
}

export function buildInfo(buildId: string, ids: readonly unknown[], uptimeSeconds: number, now = Date.now()): BuildInfo {
  return {
    buildId: /^[A-Za-z0-9_-]{1,64}$/.test(buildId) ? buildId : "unknown",
    actionsFingerprint: actionsFingerprint(ids),
    processStartedAt: new Date(now - Math.round(uptimeSeconds * 1000)).toISOString(),
  };
}
