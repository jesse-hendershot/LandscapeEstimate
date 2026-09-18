/**
 * Scheduled catalog price check.
 *
 * Fetches current prices from supplier pages that publish them (see
 * lib/price-watch/sources.ts) and writes them straight into the catalog —
 * no review step, by design. That's a deliberate departure from this app's
 * usual rule that a catalog price is never AI-guessed (see
 * claude/catalog-architecture.md): here the "guess" is a regex match against
 * a named product on a specific page, not a model, and a malformed or
 * wildly-off match is rejected in the source itself rather than applied.
 *
 * Run by hand:
 *   npx tsx scripts/refresh-prices.ts
 *
 * Runs weekly via .github/workflows/price-watch.yml, which needs a
 * DATABASE_URL repo secret (Settings -> Secrets and variables -> Actions) —
 * the same pooled connection string already used in Vercel and .env.local.
 */

import { and, eq } from "drizzle-orm";

import { db, materials } from "../lib/db";
import { PRICE_SOURCES } from "../lib/price-watch/sources";

// The live Production account. LandscapeEstimate briefly ran on a separate
// Clerk Development instance before the real Production instance went live
// (2026-09-18); that old instance's owner id
// (user_3JNYlft9JEvsryeMKWFpvxA8vXD) still has a seeded catalog sitting in
// the database, but nothing signs in as it anymore, so nothing here should
// write to it.
const OWNER_ID = "user_3JVckrnBPXt3EmCLNsrIqrGppzx";

async function main() {
  let failures = 0;

  for (const source of PRICE_SOURCES) {
    try {
      const price = await source();

      const [existing] = await db
        .select()
        .from(materials)
        .where(and(eq(materials.ownerId, OWNER_ID), eq(materials.name, price.materialName)));

      if (existing) {
        const changed = existing.unitCostCents !== price.priceCents;
        await db
          .update(materials)
          .set({
            unitCostCents: price.priceCents,
            supplier: price.supplier,
            supplierLocation: price.supplierLocation,
            priceUpdatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(materials.id, existing.id));
        console.log(
          `${changed ? "UPDATED" : "confirmed"} ${price.materialName}: ` +
            `$${(existing.unitCostCents / 100).toFixed(2)} -> $${(price.priceCents / 100).toFixed(2)} ` +
            `(${price.sourceUrl})`
        );
      } else {
        await db.insert(materials).values({
          ownerId: OWNER_ID,
          name: price.materialName,
          category: price.category,
          unit: price.unit,
          unitCostCents: price.priceCents,
          supplier: price.supplier,
          supplierLocation: price.supplierLocation,
          coverage: price.coverage,
        });
        console.log(
          `ADDED ${price.materialName} at $${(price.priceCents / 100).toFixed(2)} (${price.sourceUrl})`
        );
      }
    } catch (err) {
      failures++;
      console.error(`price check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main();
