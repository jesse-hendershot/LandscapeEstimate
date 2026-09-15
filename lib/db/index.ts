/**
 * Database connection.
 *
 * Neon's serverless driver over HTTP, which is what you want on Vercel: no
 * connection pool to exhaust when a dozen lambdas wake up at once, and no
 * cold-start handshake per request.
 *
 * `drizzle` is created once per module load and reused across invocations on a
 * warm lambda.
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy the pooled connection string from your " +
        "Neon dashboard into .env.local (and into Vercel's env vars for deploys)."
    );
  }
  return url;
}

export const db = drizzle(neon(connectionString()), { schema });

export { schema };
export * from "./schema";
