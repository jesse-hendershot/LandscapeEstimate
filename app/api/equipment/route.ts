import type { NextRequest } from "next/server";

import { HttpError, handle, parseOr400 } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { createEquipment, equipmentSchema, listEquipment, presentEquipment } from "@/lib/fleet/equipment";
import { ownsTrailer } from "@/lib/fleet/trailers";

export async function GET() {
  return handle("load equipment", async () => {
    const ownerId = await requireOwner();
    return { equipment: (await listEquipment(ownerId)).map(presentEquipment) };
  });
}

export async function POST(req: NextRequest) {
  return handle("add machine", async () => {
    const ownerId = await requireOwner();
    const input = parseOr400(equipmentSchema, await req.json());
    if (input.trailerId && !(await ownsTrailer(ownerId, input.trailerId))) throw new HttpError(400, "That trailer isn't on your account");
    return { equipment: presentEquipment(await createEquipment(ownerId, input)) };
  });
}
