import { requireOwner } from "@/lib/auth";
import { listMaterials, seedCatalogIfEmpty } from "@/lib/catalog/repo";
import { fromCents } from "@/lib/money";

import CatalogTable, { type CatalogMaterial } from "./CatalogTable";

// Prices change; never serve a cached copy of them.
export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const ownerId = await requireOwner();

  // First visit lands on a populated table rather than an empty one. Idempotent,
  // and it does nothing for an account that deliberately emptied its catalog.
  await seedCatalogIfEmpty(ownerId);
  const rows = await listMaterials(ownerId);

  const initial: CatalogMaterial[] = rows.map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    unit: m.unit,
    unitCost: fromCents(m.unitCostCents),
    supplier: m.supplier,
    supplierLocation: m.supplierLocation,
    sku: m.sku,
    coverage: m.coverage,
    notes: m.notes,
    isActive: m.isActive,
    useCount: m.useCount,
    priceUpdatedAt: m.priceUpdatedAt.toISOString(),
  }));

  return (
    <main style={{ flex: 1 }}>
      <CatalogTable initial={initial} />
    </main>
  );
}
