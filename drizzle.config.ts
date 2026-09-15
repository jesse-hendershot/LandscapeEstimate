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
 */
export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
} satisfies Config;
