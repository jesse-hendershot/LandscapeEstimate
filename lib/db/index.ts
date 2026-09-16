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

/**
 * Validate before handing the string to the driver.
 *
 * `neon()` rejects a malformed string by restating the format it wanted, which
 * tells you nothing about what yours is missing. These checks name the actual
 * problem — and the first one catches the mistake that costs the most time:
 * the example connection string from the docs, pasted verbatim, placeholder
 * dots and all.
 */
function connectionString(): string {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy the pooled connection string from the " +
        "Neon console (Connect → Connection pooling) into .env.local, and into " +
        "Vercel's environment variables for deploys."
    );
  }

  if (url.includes("...")) {
    throw new Error(
      "DATABASE_URL still contains the placeholder '...' from the example. " +
        "Replace the whole line with the real string from the Neon console: " +
        "Connect → Connection pooling on → copy."
    );
  }

  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error(
      `DATABASE_URL must start with postgresql:// — got "${url.slice(0, 12)}...". ` +
        "An https:// URL is the Data API endpoint, which is a different thing " +
        "and will not work here."
    );
  }

  // user:password@host — the part neon() complains about without naming it.
  if (!/^postgres(ql)?:\/\/[^:/?#]+:[^@/?#]+@[^/?#]+/.test(url)) {
    throw new Error(
      "DATABASE_URL has no user:password@host section. The Neon console's " +
        "Connect dialog gives you the complete string including credentials."
    );
  }

  if (!/-pooler\./.test(url)) {
    // Not fatal — a direct connection works. But serverless request handlers
    // exhaust a direct endpoint's connection limit under any real concurrency.
    console.warn(
      "DATABASE_URL is not the pooled endpoint (no '-pooler' in the host). " +
        "This works, but switch to the pooled string before deploying."
    );
  }

  return url;
}

export const db = drizzle(neon(connectionString()), { schema });

export { schema };
export * from "./schema";
