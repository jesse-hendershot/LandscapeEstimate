import type { Material } from "../db/schema";
import { fromCents, toCents } from "../money";
import type { CreateMaterialInput, UpdateMaterialInput } from "./validate";

export type PriceSource = "starter" | "sheet" | "receipt" | "manual";

/** Cents and thousandths live in the database; dollars and tons cross the wire. */
export function presentMaterial(m: Material) {
  return {
    id: m.id,
    name: m.name,
    category: m.category,
    unit: m.unit,
    unitCost: fromCents(m.unitCostCents),
    supplier: m.supplier,
    supplierLocation: m.supplierLocation,
    supplierId: m.supplierId,
    sku: m.sku,
    coverage: m.coverage,
    notes: m.notes,
    specClass: m.specClass,
    tonsPerCuYd: m.tonsPerCuYdMilli === null ? null : m.tonsPerCuYdMilli / 1000,
    haul: m.haul,
    unitsPerPallet: m.unitsPerPalletMilli === null ? null : m.unitsPerPalletMilli / 1000,
    palletDeposit: fromCents(m.palletDepositCents),
    isActive: m.isActive,
    useCount: m.useCount,
    priceUpdatedAt: m.priceUpdatedAt.toISOString(),
    priceSource: m.priceSource as PriceSource,
    priceSourceLabel: m.priceSourceLabel,
  };
}

export type CatalogMaterialDto = ReturnType<typeof presentMaterial>;

/** Map validated input onto column values. Only fields present are set. */
export function materialColumns(input: Partial<CreateMaterialInput & UpdateMaterialInput>) {
  const out: Record<string, unknown> = {};
  const copy = ["name", "category", "unit", "supplier", "supplierLocation", "coverage", "notes", "specClass", "haul", "isActive"] as const;
  for (const k of copy) if (input[k] !== undefined) out[k] = input[k];
  if (input.sku !== undefined) out.sku = input.sku ?? null;
  if (input.unitCost !== undefined) out.unitCostCents = toCents(input.unitCost);
  if (input.supplierId !== undefined) out.supplierId = input.supplierId ?? null;
  if (input.tonsPerCuYd !== undefined) out.tonsPerCuYdMilli = input.tonsPerCuYd == null ? null : Math.round(input.tonsPerCuYd * 1000);
  if (input.unitsPerPallet !== undefined) out.unitsPerPalletMilli = input.unitsPerPallet == null ? null : Math.round(input.unitsPerPallet * 1000);
  if (input.palletDeposit !== undefined) out.palletDepositCents = toCents(input.palletDeposit);
  return out;
}
