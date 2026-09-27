import type { NextRequest } from "next/server";

import { HttpError, handle, isUuid, parseOr400 } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { presentTruck, truckRowFrom, truckSchema } from "@/lib/trucks/present";
import { removeTruck, updateTruck } from "@/lib/trucks/repo";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle("update truck", async () => {
    const ownerId = await requireOwner();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "Not found");
    const input = parseOr400(truckSchema.partial(), await req.json());
    const row = await updateTruck(ownerId, id, truckRowFrom(input));
    if (!row) throw new HttpError(404, "Not found");
    return { truck: presentTruck(row) };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle("remove truck", async () => {
    const ownerId = await requireOwner();
    const { id } = await params;
    if (!isUuid(id) || !(await removeTruck(ownerId, id))) throw new HttpError(404, "Not found");
    return { removed: true };
  });
}
