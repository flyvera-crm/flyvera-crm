// GET /api/build-info: which build this server process runs, and a fingerprint of the Server Action IDs
// it has loaded. Read-only, no login, no data, no secrets. Used after each deploy to check that every
// process agrees and that the action IDs stay the same across deploys (fixed NEXT_SERVER_ACTIONS_ENCRYPTION_KEY).
import { readFileSync } from "node:fs";
import path from "node:path";
import { saveCustomer } from "@/lib/actions/customers";
import { saveLead, setLeadStatus } from "@/lib/actions/leads";
import { buildInfo, serverActionId } from "@/lib/build-info";

const BUILD_ID = (() => {
  try {
    return readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return "unknown";
  }
})();

export function GET() {
  const ids = [saveCustomer, saveLead, setLeadStatus].map(serverActionId);
  return Response.json(buildInfo(BUILD_ID, ids, process.uptime()), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
