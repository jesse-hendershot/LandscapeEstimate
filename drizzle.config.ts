import type { Config } from "drizzle-kit";

/**
 * Migrations.
 *
 *   npx drizzle-kit generate   — write a migration from schema changes
 *   npx drizzle-kit migrate    — apply pending migrations
 *
 * Generate-then-apply rather than `push`, so every schema change is a file you
 * can read, review and roll back. `push` is fine while a schema is throwaway;
 * this one holds a shop's pricing.
 *
 * ── Why the env loading below ──────────────────────────────────────────────
 *
 * `.env.local` is a Next.js convention. Next loads it automatically; nothing
 * else does. drizzle-kit is a standalone CLI, so it sees only `process.env` and
 * reports `url: undefined` no matter what is in that file.
 *
 * `process.loadEnvFile` is built into Node (20.12+), so this needs no dotenv
 * dependency. It throws when the file is missing, which is why it is wrapped —
 * on Vercel and in CI the variables come from the platform and there is no
 * `.env.local` to read.
 */

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Not present — fine. Either the next file has it, or the environment does.
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set.\n" +
      "Add it to .env.local as a single line, for example:\n" +
      "  DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require\n" +
      "Use the POOLED string (it has -pooler in the hostname) from the Neon console's Connect dialog."
  );
}

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
} satisfies Config;
