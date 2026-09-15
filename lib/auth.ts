/**
 * Auth helpers.
 *
 * Every data access in this app goes through `requireOwner()`. That is not
 * ceremony — it is the thing that keeps one estimator's catalog and pricing
 * from leaking into another's. There is no query anywhere that is not scoped by
 * `ownerId`, and the only source of `ownerId` is Clerk.
 */

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { profiles, type Profile } from "./db/schema";

export class Unauthorized extends Error {
  constructor() {
    super("not signed in");
    this.name = "Unauthorized";
  }
}

/** The signed-in Clerk user id, or throw. */
export async function requireOwner(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Unauthorized();
  return userId;
}

/**
 * The signed-in user's profile, created on first sight.
 *
 * Clerk owns identity; this row owns the shop-specific settings Clerk knows
 * nothing about — default markup and tax rate. Creating it lazily means there
 * is no webhook to keep in sync and no way to end up signed in without one.
 */
export async function requireProfile(): Promise<Profile> {
  const ownerId = await requireOwner();

  const existing = await db.select().from(profiles).where(eq(profiles.id, ownerId)).limit(1);
  if (existing.length > 0) return existing[0];

  const [created] = await db
    .insert(profiles)
    .values({ id: ownerId })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  // Lost an insert race with a concurrent request — read it back.
  const [row] = await db.select().from(profiles).where(eq(profiles.id, ownerId)).limit(1);
  return row;
}

/** Maps a thrown Unauthorized onto a 401 without leaking anything else. */
export function authErrorResponse(err: unknown): Response | null {
  if (err instanceof Unauthorized) {
    return new Response(JSON.stringify({ error: "Not signed in" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
