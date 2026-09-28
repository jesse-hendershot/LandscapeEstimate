import type { NextRequest } from "next/server";
import { z } from "zod";

import { HttpError, handle, parseOr400 } from "@/lib/api";
import { requireProfile } from "@/lib/auth";
import { createMaterial, getMaterial, updateMaterial } from "@/lib/catalog/repo";
import { CATEGORIES } from "@/lib/catalog/seed";
import { earthKind } from "@/lib/earthwork/factors";
import { UNITS } from "@/lib/estimate/schema";
import { geocodeAddress, localityOf } from "@/lib/geo/geocode";
import { toCents } from "@/lib/money";
import { createSupplier, getSupplier } from "@/lib/suppliers/repo";

const itemSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), materialId: z.string().uuid(), unitCost: z.number().positive().max(10_000) }),
  z.object({
    action: z.literal("new"),
    name: z.string().trim().min(2).max(160),
    unit: z.enum(UNITS as unknown as [string, ...string[]]),
    unitCost: z.number().positive().max(10_000),
    category: z.enum(CATEGORIES as unknown as [string, ...string[]]).optional(),
  }),
]);

const bodySchema = z.object({
  supplierId: z.string().uuid().nullish(),
  newSupplier: z.object({ name: z.string().trim().min(2).max(160), address: z.string().trim().max(240).default("") }).nullish(),
  items: z.array(itemSchema).min(1).max(60),
});

/** Guess a category for a new material from its name. */
function categoryFor(name: string): string {
  const k = earthKind(name);
  if (k === "mulch") return "mulch";
  if (k === "topsoil" || k === "fill" || k === "compost") return "soil";
  if (k !== "other") return "aggregate";
  if (/sod/i.test(name)) return "sod";
  if (/paver|block|wall|stone step/i.test(name)) return "hardscape";
  if (/edg/i.test(name)) return "edging";
  if (/fabric|blanket|barrier/i.test(name)) return "fabric";
  if (/staple|stake|pin|pipe|fitting/i.test(name)) return "hardware";
  if (/seed|fertiliz|lime|stimulat/i.test(name)) return "amendment";
  return "other";
}

/**
 * POST /api/catalog/scan/apply — apply the receipt rows the estimator ticked.
 * Every price here was read off paper and approved by a person.
 */
export async function POST(req: NextRequest) {
  return handle("apply receipt", async () => {
    const profile = await requireProfile();
    const body = parseOr400(bodySchema, await req.json());

    let supplierId = body.supplierId ?? null;
    let supplierName = "";
    if (supplierId) {
      const s = await getSupplier(profile.id, supplierId);
      if (!s) throw new HttpError(400, "Unknown supplier");
      supplierName = s.name;
    } else if (body.newSupplier) {
      const g = body.newSupplier.address
        ? await geocodeAddress(body.newSupplier.address, localityOf(profile.shopAddress) || "Iowa")
        : null;
      const s = await createSupplier(profile.id, {
        name: body.newSupplier.name,
        address: body.newSupplier.address,
        lat: g?.lat ?? null,
        lng: g?.lng ?? null,
      });
      supplierId = s.id;
      supplierName = s.name;
    }

    let updated = 0;
    let created = 0;
    for (const item of body.items) {
      if (item.action === "update") {
        const m = await getMaterial(profile.id, item.materialId);
        if (!m) continue;
        await updateMaterial(profile.id, m.id, {
          unitCostCents: toCents(item.unitCost),
          ...(supplierId && !m.supplierId ? { supplierId } : {}),
        });
        updated++;
      } else {
        const base = {
          category: item.category ?? categoryFor(item.name),
          unit: item.unit,
          unitCostCents: toCents(item.unitCost),
          supplierId,
          supplier: supplierName,
          notes: "Added from a scanned receipt.",
        };
        try {
          await createMaterial(profile.id, { ...base, name: item.name });
        } catch {
          // Same name already in the catalog: keep both, distinguished by supplier.
          await createMaterial(profile.id, { ...base, name: `${item.name} — ${supplierName || "receipt"}`.slice(0, 160) });
        }
        created++;
      }
    }

    return { updated, created, supplierId };
  });
}
