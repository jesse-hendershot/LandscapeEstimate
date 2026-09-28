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
import { createSupplier, getSupplier, updateSupplier } from "@/lib/suppliers/repo";

const specClass = z.string().trim().max(80).optional();

const itemSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), materialId: z.string().uuid(), unitCost: z.number().positive().max(10_000), specClass }),
  z.object({
    action: z.literal("new"),
    name: z.string().trim().min(2).max(160),
    unit: z.enum(UNITS as unknown as [string, ...string[]]),
    unitCost: z.number().positive().max(10_000),
    category: z.enum(CATEGORIES as unknown as [string, ...string[]]).optional(),
    specClass,
  }),
]);

const bodySchema = z.object({
  kind: z.enum(["receipt", "sheet"]).default("receipt"),
  /** Date printed on the sheet or receipt. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""),
  supplierId: z.string().uuid().nullish(),
  newSupplier: z
    .object({ name: z.string().trim().min(2).max(160), address: z.string().trim().max(240).default(""), phone: z.string().trim().max(40).default("") })
    .nullish(),
  /** From a price sheet: save this as the supplier's flat delivery fee. */
  deliveryFee: z.number().min(0).max(5000).nullish(),
  deliveryText: z.string().trim().max(400).optional(),
  items: z.array(itemSchema).min(1).max(120),
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
 * POST /api/catalog/scan/apply — apply the rows the estimator ticked.
 * Every price here was read off the supplier's own paper and approved by a
 * person, and each one says so: "Conklin Quarry price sheet, 2026-09-29".
 */
export async function POST(req: NextRequest) {
  return handle("apply prices", async () => {
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
        kind: body.kind === "sheet" ? "quarry" : "yard",
        address: body.newSupplier.address,
        phone: body.newSupplier.phone,
        lat: g?.lat ?? null,
        lng: g?.lng ?? null,
      });
      supplierId = s.id;
      supplierName = s.name;
    }

    if (supplierId && body.deliveryFee !== undefined && body.deliveryFee !== null) {
      await updateSupplier(profile.id, supplierId, {
        deliveryFeeCents: toCents(body.deliveryFee),
        ...(body.deliveryText ? { notes: `Delivery (from their price sheet): ${body.deliveryText}`.slice(0, 600) } : {}),
      });
    }

    const source = body.kind === "sheet" ? "sheet" : "receipt";
    const label = [supplierName || "Supplier", body.kind === "sheet" ? "price sheet" : "receipt"].join(" ") + (body.date ? `, ${body.date}` : "");

    let updated = 0;
    let created = 0;
    for (const item of body.items) {
      if (item.action === "update") {
        const m = await getMaterial(profile.id, item.materialId);
        if (!m) continue;
        // Never let one supplier's paper reprice another supplier's row.
        if (supplierId && m.supplierId && m.supplierId !== supplierId) continue;
        await updateMaterial(
          profile.id,
          m.id,
          {
            unitCostCents: toCents(item.unitCost),
            priceSource: source,
            priceSourceLabel: label,
            ...(supplierId && !m.supplierId ? { supplierId, supplier: supplierName } : {}),
            ...(item.specClass !== undefined && item.specClass !== m.specClass ? { specClass: item.specClass } : {}),
          },
          { observedOn: body.date }
        );
        updated++;
      } else {
        const base = {
          category: item.category ?? categoryFor(item.name),
          unit: item.unit,
          unitCostCents: toCents(item.unitCost),
          supplierId,
          supplier: supplierName,
          specClass: item.specClass ?? "",
          priceSource: source,
          priceSourceLabel: label,
          notes: body.kind === "sheet" ? "Added from a price sheet." : "Added from a scanned receipt.",
        };
        try {
          await createMaterial(profile.id, { ...base, name: item.name }, { observedOn: body.date });
        } catch {
          // Same name already in the catalog: keep both, distinguished by supplier.
          await createMaterial(profile.id, { ...base, name: `${item.name} — ${supplierName || source}`.slice(0, 160) }, { observedOn: body.date });
        }
        created++;
      }
    }

    return { updated, created, supplierId };
  });
}
