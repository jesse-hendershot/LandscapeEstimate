import type { NextRequest } from "next/server";

import { handle, parseOr400 } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { createTrailer, listTrailers, presentTrailer, trailerSchema } from "@/lib/fleet/trailers";

export async function GET() {
  return handle("load trailers", async () => {
    const ownerId = await requireOwner();
    return { trailers: (await listTrailers(ownerId)).map(presentTrailer) };
  });
}

export async function POST(req: NextRequest) {
  return handle("add trailer", async () => {
    const ownerId = await requireOwner();
    const input = parseOr400(trailerSchema, await req.json());
    return { trailer: presentTrailer(await createTrailer(ownerId, input)) };
  });
}
