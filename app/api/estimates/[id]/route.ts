import type { NextRequest } from "next/server";

import { HttpError, handle, isUuid, parseOr400 } from "@/lib/api";
import { requireOwner, requireProfile } from "@/lib/auth";
import { estimatePatchSchema, getEstimateView, saveEstimate } from "@/lib/estimates/service";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/estimates/:id — the estimate as last saved, plus the original. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle("load estimate", async () => {
    const ownerId = await requireOwner();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "Not found");
    const view = await getEstimateView(ownerId, id);
    if (!view) throw new HttpError(404, "Not found");
    return view;
  });
}

/**
 * PATCH /api/estimates/:id — save edits (lines, trucks, markup) and field-test
 * numbers. Lines re-plan the haul and re-derive the correction log.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle("save estimate", async () => {
    const profile = await requireProfile();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "Not found");
    const patch = parseOr400(estimatePatchSchema, await req.json());
    const view = await saveEstimate(profile, id, patch);
    if (!view) throw new HttpError(404, "Not found");
    return view;
  });
}
