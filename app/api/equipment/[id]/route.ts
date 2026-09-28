import type { NextRequest } from "next/server";

import { HttpError, handle, isUuid, parseOr400 } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { equipmentSchema, presentEquipment, removeEquipment, updateEquipment } from "@/lib/fleet/equipment";
import { ownsTrailer } from "@/lib/fleet/trailers";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle("update machine", async () => {
    const ownerId = await requireOwner();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "Not found");
    const input = parseOr400(equipmentSchema.partial(), await req.json());
    if (input.trailerId && !(await ownsTrailer(ownerId, input.trailerId))) throw new HttpError(400, "That trailer isn't on your account");
    const row = await updateEquipment(ownerId, id, input);
    if (!row) throw new HttpError(404, "Not found");
    return { equipment: presentEquipment(row) };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle("remove machine", async () => {
    const ownerId = await requireOwner();
    const { id } = await params;
    if (!isUuid(id) || !(await removeEquipment(ownerId, id))) throw new HttpError(404, "Not found");
    return { removed: true };
  });
}
