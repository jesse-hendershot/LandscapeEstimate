/**
 * Request validation for catalog writes.
 *
 * The catalog is the source of truth for pricing, so a bad row here is worse
 * than a bad model output — a wrong catalog price is silently correct-looking
 * on every future estimate until someone notices. Validate hard on the way in.
 */

import { z } from "zod";

import { UNITS } from "../estimate/schema";
import { CATEGORIES } from "./seed";

const unitSchema = z.enum(UNITS as unknown as [string, ...string[]]);
const categorySchema = z.enum(CATEGORIES as unknown as [string, ...string[]]);

/**
 * Upper bound is a sanity rail, not a business rule: $10,000 per unit is
 * far past any landscaping material and almost always a decimal slip or a
 * pallet price entered as a unit price.
 */
const unitCostSchema = z
  .number()
  .finite()
  .positive("price must be greater than zero")
  .max(10_000, "price over $10,000 per unit — check for a decimal or pallet-vs-unit mixup");

export const createMaterialSchema = z.object({
  name: z.string().trim().min(2, "name is too short").max(160),
  category: categorySchema.default("other"),
  unit: unitSchema,
  unitCost: unitCostSchema,
  supplier: z.string().trim().max(160).default(""),
  supplierLocation: z.string().trim().max(160).default(""),
  sku: z.string().trim().max(80).nullish(),
  coverage: z.string().trim().max(240).default(""),
  notes: z.string().trim().max(600).default(""),
});

export const updateMaterialSchema = createMaterialSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });

export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;

/** Flatten a ZodError into something a form can render next to fields. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
