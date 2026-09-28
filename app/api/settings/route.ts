import type { NextRequest } from "next/server";

import { handle, parseOr400 } from "@/lib/api";
import { requireProfile } from "@/lib/auth";
import { currentFuel } from "@/lib/haul/fuel";
import { presentSettings, settingsPatchSchema, updateSettings } from "@/lib/settings";

/** GET /api/settings — the shop's settings plus this week's fuel prices. */
export async function GET() {
  return handle("load settings", async () => {
    const profile = await requireProfile();
    const fuel = await currentFuel(profile);
    return { settings: presentSettings(profile), diesel: fuel.diesel, fuel };
  });
}

/** PATCH /api/settings — partial update. Changing the shop address re-locates it. */
export async function PATCH(req: NextRequest) {
  return handle("save settings", async () => {
    const profile = await requireProfile();
    const patch = parseOr400(settingsPatchSchema, await req.json());
    const { profile: next, warning } = await updateSettings(profile, patch);
    const fuel = await currentFuel(next);
    return { settings: presentSettings(next), diesel: fuel.diesel, fuel, warning };
  });
}
