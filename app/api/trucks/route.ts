import type { NextRequest } from "next/server";

import { HttpError, handle, parseOr400 } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { ownsTrailer } from "@/lib/fleet/trailers";
import { presentTruck, truckRowFrom, truckSchema } from "@/lib/trucks/present";
import { createTruck, listTrucks, seedTrucksIfEmpty } from "@/lib/trucks/repo";
import type { NewTruckRow } from "@/lib/db/schema";

export async function GET() {
  return handle("load trucks", async () => {
    const ownerId = await requireOwner();
    await seedTrucksIfEmpty(ownerId);
    return { trucks: (await listTrucks(ownerId)).map(presentTruck) };
  });
}

export async function POST(req: NextRequest) {
  return handle("add truck", async () => {
    const ownerId = await requireOwner();
    const input = parseOr400(truckSchema.partial({ fuel: true, trailerId: true }), await req.json());
    if (input.trailerId && !(await ownsTrailer(ownerId, input.trailerId))) throw new HttpError(400, "That trailer isn't on your account");
    const row = await createTruck(ownerId, truckRowFrom(input) as Omit<NewTruckRow, "ownerId" | "id">);
    return { truck: presentTruck(row) };
  });
}
