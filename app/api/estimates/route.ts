import { handle } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { listEstimates } from "@/lib/estimates/service";

/** GET /api/estimates — this account's estimates, newest first. */
export async function GET() {
  return handle("load estimates", async () => {
    const ownerId = await requireOwner();
    return { estimates: await listEstimates(ownerId) };
  });
}
