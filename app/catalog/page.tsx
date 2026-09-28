import { requireProfile } from "@/lib/auth";
import { presentMaterial } from "@/lib/catalog/present";
import { listMaterials, seedCatalogIfEmpty } from "@/lib/catalog/repo";
import { listSuppliers } from "@/lib/suppliers/repo";

import CatalogTable from "./CatalogTable";

// Prices change; never serve a cached copy of them.
export const dynamic = "force-dynamic";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ import?: string }> }) {
  const sp = await searchParams;
  const openImport = sp.import === "sheet" || sp.import === "receipt" ? sp.import : undefined;
  // requireProfile rather than requireOwner: it creates the profile row on
  // first sight, so an account never has a catalog without markup and tax.
  const { id: ownerId } = await requireProfile();

  // First visit lands on a populated table rather than an empty one. Idempotent,
  // and it does nothing for an account that deliberately emptied its catalog.
  await seedCatalogIfEmpty(ownerId);
  const [rows, suppliers] = await Promise.all([listMaterials(ownerId), listSuppliers(ownerId)]);

  return (
    <main style={{ flex: 1 }}>
      <CatalogTable
        initial={rows.map(presentMaterial)}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, located: s.lat !== null && s.lng !== null }))}
        openImport={openImport}
      />
    </main>
  );
}
