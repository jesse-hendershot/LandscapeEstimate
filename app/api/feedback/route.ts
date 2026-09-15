import { NextRequest, NextResponse } from "next/server";

import { logEdit } from "@/lib/estimate/log";
import type { LineItem } from "@/lib/estimate/schema";

/**
 * Receives the edits a contractor makes to a generated estimate.
 *
 * This is the labeling step, and the reason it is worth having is that it costs
 * the contractor nothing — they were going to fix the wrong line anyway. An
 * edited line is a line the model got wrong, which is exactly the label a
 * learned verifier needs and exactly the label nobody wants to sit down and
 * produce by hand.
 *
 * Fire and forget from the client: never block the UI on this, and never show
 * an error if it fails. A dropped label is worth nothing; a spinner stuck on a
 * logging call costs a real estimate.
 */

interface EditPayload {
  runId?: string;
  edits?: {
    lineIndex: number;
    material: string;
    field: keyof LineItem;
    before: string | number;
    after: string | number;
  }[];
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as EditPayload;
    const runId = body.runId;
    const edits = Array.isArray(body.edits) ? body.edits : [];

    if (!runId || edits.length === 0) {
      return NextResponse.json({ recorded: 0 });
    }

    const at = new Date().toISOString();
    for (const e of edits.slice(0, 200)) {
      if (typeof e?.lineIndex !== "number" || !e?.field) continue;
      await logEdit({
        runId,
        at,
        lineIndex: e.lineIndex,
        material: String(e.material ?? ""),
        field: e.field,
        before: e.before ?? "",
        after: e.after ?? "",
      });
    }

    return NextResponse.json({ recorded: edits.length });
  } catch {
    // Never surface a logging failure to the contractor.
    return NextResponse.json({ recorded: 0 });
  }
}
