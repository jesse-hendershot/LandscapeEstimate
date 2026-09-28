/**
 * Machines, owner-scoped: data access, wire shape and validation.
 *
 * Everything a shop needs to describe a machine for costing is here and
 * editable in Settings: what it is, what it burns and how much an hour, what
 * it rides to the job on, and how many trips that takes.
 */

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { equipment, type EquipmentRow, type NewEquipmentRow } from "../db/schema";

export const EQUIPMENT_KINDS = ["skid_steer", "track_loader", "mini_excavator", "excavator", "tractor", "other"] as const;
export const EQUIPMENT_FUELS = ["offroad", "diesel", "gas"] as const;

export const KIND_LABEL: Record<(typeof EQUIPMENT_KINDS)[number], string> = {
  skid_steer: "Skid steer",
  track_loader: "Compact track loader",
  mini_excavator: "Mini excavator",
  excavator: "Excavator",
  tractor: "Tractor",
  other: "Other machine",
};

export function presentEquipment(e: EquipmentRow) {
  return {
    id: e.id,
    name: e.name,
    kind: e.kind as (typeof EQUIPMENT_KINDS)[number],
    fuel: e.fuel as (typeof EQUIPMENT_FUELS)[number],
    galPerHour: e.galPerHourTenths / 10,
    trailerId: e.trailerId,
    haulTrips: e.haulTrips,
    notes: e.notes,
  };
}

export type EquipmentDto = ReturnType<typeof presentEquipment>;

export const equipmentSchema = z.object({
  name: z.string().trim().min(1, "give it a name").max(80),
  kind: z.enum(EQUIPMENT_KINDS),
  fuel: z.enum(EQUIPMENT_FUELS),
  galPerHour: z.number().min(0).max(40),
  trailerId: z.string().uuid().nullable(),
  haulTrips: z.number().int().min(0).max(10),
  notes: z.string().trim().max(400),
});

export function equipmentRowFrom(input: Partial<z.infer<typeof equipmentSchema>>) {
  const row: Partial<NewEquipmentRow> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.kind !== undefined) row.kind = input.kind;
  if (input.fuel !== undefined) row.fuel = input.fuel;
  if (input.galPerHour !== undefined) row.galPerHourTenths = Math.round(input.galPerHour * 10);
  if (input.trailerId !== undefined) row.trailerId = input.trailerId;
  if (input.haulTrips !== undefined) row.haulTrips = input.haulTrips;
  if (input.notes !== undefined) row.notes = input.notes;
  return row;
}

export async function listEquipment(ownerId: string): Promise<EquipmentRow[]> {
  return db
    .select()
    .from(equipment)
    .where(and(eq(equipment.ownerId, ownerId), eq(equipment.isActive, true)))
    .orderBy(asc(equipment.createdAt));
}

export async function createEquipment(ownerId: string, input: z.infer<typeof equipmentSchema>): Promise<EquipmentRow> {
  const [row] = await db
    .insert(equipment)
    .values({ ...(equipmentRowFrom(input) as Omit<NewEquipmentRow, "ownerId">), ownerId })
    .returning();
  return row;
}

export async function updateEquipment(
  ownerId: string,
  id: string,
  input: Partial<z.infer<typeof equipmentSchema>>
): Promise<EquipmentRow | null> {
  const [row] = await db
    .update(equipment)
    .set({ ...equipmentRowFrom(input), updatedAt: new Date() })
    .where(and(eq(equipment.ownerId, ownerId), eq(equipment.id, id)))
    .returning();
  return row ?? null;
}

/** Soft delete: old estimates that used it still read correctly. */
export async function removeEquipment(ownerId: string, id: string): Promise<boolean> {
  const [row] = await db
    .update(equipment)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(equipment.ownerId, ownerId), eq(equipment.id, id)))
    .returning({ id: equipment.id });
  return Boolean(row);
}
