import type { NextRequest } from "next/server";

import { handle, parseOr400 } from "@/lib/api";
import { requireProfile } from "@/lib/auth";
import { currentDiesel } from "@/lib/haul/fuel";
import { presentSettings, settingsPatchSchema, updateSettings } from "@/lib/settings";

/** GET /api/settings — the shop's settings plus this week's diesel. */
export async function GET() {
  return handle("load settings", async () => {
    const profile = await requireProfile();
    const diesel = await currentDiesel(profile);
    return { settings: presentSettings(profile), diesel };
  });
}

/** PATCH /api/settings — partial update. Changing the shop address re-locates it. */
export async function PATCH(req: NextRequest) {
  return handle("save settings", async () => {
    const profile = await requireProfile();
    const patch = parseOr400(settingsPatchSchema, await req.json());
    const { profile: next, warning } = await updateSettings(profile, patch);
    const diesel = await currentDiesel(next);
    return { settings: presentSettings(next), diesel, warning };
  });
}
