import { NextRequest, NextResponse } from "next/server";

import { authErrorResponse, requireProfile } from "@/lib/auth";
import { InputError, parseEstimateInput, runEstimate } from "@/lib/estimate/pipeline";

/**
 * POST /api/estimate
 *
 * Body: { jobAddress, jobDescription, contractorName?, measurements?,
 *         trucksForJob?, answers?, previousEstimateId? }
 *
 * `answers` + `previousEstimateId` is a refinement: the contractor answered
 * the follow-up questions, and the whole pipeline re-runs with those answers —
 * same gates, same locality, same arithmetic — instead of patching lines
 * outside the gates the way the old /api/refine did.
 *
 * All the work is in lib/estimate/pipeline.ts.
 */

export const maxDuration = 180;

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile();
    const input = parseEstimateInput(await req.json());
    return NextResponse.json(await runEstimate(profile, input));
  } catch (err) {
    const unauth = authErrorResponse(err);
    if (unauth) return unauth;
    if (err instanceof InputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("estimate route error", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
