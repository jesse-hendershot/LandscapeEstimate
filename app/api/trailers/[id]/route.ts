import type { NextRequest } from "next/server";

import { HttpError, handle, isUuid, parseOr400 } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { presentTrailer, removeTrailer, trailerSchema, updateTrailer } from "@/lib/fleet/trailers";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle("update trailer", async () => {
    const ownerId = await requireOwner();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, "Not found");
    const input = parseOr400(trailerSchema.partial(), await req.json());
    const row = await updateTrailer(ownerId, id, input);
    if (!row) throw new HttpError(404, "Not found");
    return { trailer: presentTrailer(row) };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle("remove trailer", async () => {
    const ownerId = await requireOwner();
    const { id } = await params;
    if (!isUuid(id) || !(await removeTrailer(ownerId, id))) throw new HttpError(404, "Not found");
    return { removed: true };
  });
}
