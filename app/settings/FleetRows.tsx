"use client";

/**
 * Editable rows for the fleet: trucks, trailers, machines. Each row is its
 * own little form — change what you like, then Save that row.
 */

import { useState } from "react";

import { C } from "../theme";
import { fieldLabel, input, Num, patchJson, rowBox, RowActions } from "./ui";

export interface Truck {
  id: string;
  name: string;
  kind: "dump" | "pickup";
  fuel: "diesel" | "gas";
  trailerId: string | null;
  capacityTons: number;
  capacityCuYd: number;
  mpg: number;
  costPerHour: number;
}

export interface Trailer {
  id: string;
  name: string;
  kind: "dump" | "equipment" | "utility";
  capacityTons: number;
  capacityCuYd: number;
}

export interface Machine {
  id: string;
  name: string;
  kind: "skid_steer" | "track_loader" | "mini_excavator" | "excavator" | "tractor" | "other";
  fuel: "offroad" | "diesel" | "gas";
  galPerHour: number;
  trailerId: string | null;
  haulTrips: number;
  notes: string;
}

const TRAILER_WORD: Record<Trailer["kind"], string> = {
  dump: "Dump trailer",
  equipment: "Equipment trailer",
  utility: "Utility trailer",
};

const MACHINE_WORD: Record<Machine["kind"], string> = {
  skid_steer: "Skid steer",
  track_loader: "Compact track loader",
  mini_excavator: "Mini excavator",
  excavator: "Excavator",
  tractor: "Tractor",
  other: "Other",
};

/** Typical burn at working load, for the hint under gal/hr. */
const TYPICAL_GPH: Record<Machine["kind"], string> = {
  skid_steer: "most skid steers burn 2–3.5 gal/hr",
  track_loader: "most track loaders burn 2.5–4 gal/hr",
  mini_excavator: "most mini excavators burn 1–2.5 gal/hr",
  excavator: "a 12–20 ton excavator burns 3–5 gal/hr",
  tractor: "a compact tractor burns 1–3 gal/hr",
  other: "check the manual or a fuel receipt",
};

async function del(url: string, what: string): Promise<boolean> {
  if (!confirm(`Remove "${what}"?`)) return false;
  const res = await fetch(url, { method: "DELETE" });
  return res.ok;
}

// ── trucks ─────────────────────────────────────────────────────────────────

export function TruckRow({
  truck,
  trailers,
  onSaved,
  onRemoved,
}: {
  truck: Truck;
  trailers: Trailer[];
  onSaved: (t: Truck) => void;
  onRemoved: (id: string) => void;
}) {
  const [t, setT] = useState(truck);
  const [state, setState] = useState("");
  const dirty = JSON.stringify(t) !== JSON.stringify(truck);
  const hitched = trailers.find((x) => x.id === t.trailerId) ?? null;
  const pullsDump = hitched?.kind === "dump";

  async function save() {
    setState("saving");
    const { id, ...body } = t;
    const r = await patchJson<Truck>(`/api/trucks/${id}`, body, "truck");
    if (!r.ok) return setState(r.error);
    onSaved(r.value);
    setState("saved");
  }

  return (
    <div style={rowBox}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label="Truck name" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} style={{ ...input, flex: "1 1 200px", fontWeight: 700 }} />
        <select aria-label="Truck type" value={t.kind} onChange={(e) => setT({ ...t, kind: e.target.value as Truck["kind"] })} style={{ ...input, width: 200 }}>
          <option value="pickup">Pickup / flatbed</option>
          <option value="dump">Dump truck (own dump bed)</option>
        </select>
        <select aria-label="Fuel" value={t.fuel} onChange={(e) => setT({ ...t, fuel: e.target.value as Truck["fuel"] })} style={{ ...input, width: 120 }}>
          <option value="diesel">Diesel</option>
          <option value="gas">Gas</option>
        </select>
      </div>

      <label style={fieldLabel}>
        Usually pulls
        <div style={{ marginTop: 4 }}>
          <select aria-label="Trailer it pulls" value={t.trailerId ?? ""} onChange={(e) => setT({ ...t, trailerId: e.target.value || null })} style={{ ...input, maxWidth: 360 }}>
            <option value="">No trailer</option>
            {trailers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({TRAILER_WORD[x.kind].toLowerCase()})
              </option>
            ))}
          </select>
        </div>
      </label>

      <div style={{ fontSize: 14, color: C.grey }}>
        {pullsDump
          ? `Hauls rock and dirt in the ${hitched!.name}: ${hitched!.capacityTons} tons / ${hitched!.capacityCuYd} cu yd a load.`
          : t.kind === "dump"
            ? "Hauls rock and dirt in its own bed."
            : hitched
              ? `Pulls the ${hitched.name} when a machine goes out; does store runs otherwise.`
              : "Does store runs — bags, rolls, pipe, pavers. Give it a dump trailer to haul rock."}
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        {t.kind === "dump" && !pullsDump && (
          <>
            <label style={fieldLabel}>
              Carries
              <div style={{ marginTop: 4 }}>
                <Num ariaLabel="Capacity in tons" value={t.capacityTons} onChange={(n) => setT({ ...t, capacityTons: n })} suffix="tons" width={90} />
              </div>
            </label>
            <label style={fieldLabel}>
              Bed holds
              <div style={{ marginTop: 4 }}>
                <Num ariaLabel="Capacity in cubic yards" value={t.capacityCuYd} onChange={(n) => setT({ ...t, capacityCuYd: n })} suffix="cu yd" width={90} />
              </div>
            </label>
          </>
        )}
        <label style={fieldLabel}>
          Gets, while working{hitched ? " (towing)" : ""}
          <div style={{ marginTop: 4 }}>
            <Num ariaLabel="Miles per gallon" value={t.mpg} onChange={(n) => setT({ ...t, mpg: n })} suffix="mpg" width={80} />
          </div>
        </label>
        <label style={fieldLabel}>
          Truck + driver, per hour (not fuel)
          <div style={{ marginTop: 4 }}>
            <Num ariaLabel="Cost per hour" value={t.costPerHour} onChange={(n) => setT({ ...t, costPerHour: n })} suffix="$/hr" width={100} />
          </div>
        </label>
      </div>

      <RowActions
        dirty={dirty}
        state={state}
        onSave={save}
        onRemove={async () => {
          if (await del(`/api/trucks/${t.id}`, t.name)) onRemoved(t.id);
        }}
        saveLabel="Save truck"
      />
    </div>
  );
}

// ── trailers ───────────────────────────────────────────────────────────────

export function TrailerRow({ trailer, onSaved, onRemoved }: { trailer: Trailer; onSaved: (t: Trailer) => void; onRemoved: (id: string) => void }) {
  const [t, setT] = useState(trailer);
  const [state, setState] = useState("");
  const dirty = JSON.stringify(t) !== JSON.stringify(trailer);

  async function save() {
    setState("saving");
    const { id, ...body } = t;
    const r = await patchJson<Trailer>(`/api/trailers/${id}`, body, "trailer");
    if (!r.ok) return setState(r.error);
    onSaved(r.value);
    setState("saved");
  }

  return (
    <div style={rowBox}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label="Trailer name" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} style={{ ...input, flex: "1 1 200px", fontWeight: 700 }} />
        <select aria-label="Trailer type" value={t.kind} onChange={(e) => setT({ ...t, kind: e.target.value as Trailer["kind"] })} style={{ ...input, width: 200 }}>
          <option value="dump">Dump trailer</option>
          <option value="equipment">Equipment trailer</option>
          <option value="utility">Utility trailer</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <label style={fieldLabel}>
          Payload
          <div style={{ marginTop: 4 }}>
            <Num ariaLabel="Payload in tons" value={t.capacityTons} onChange={(n) => setT({ ...t, capacityTons: n })} suffix="tons" width={90} />
          </div>
        </label>
        {t.kind === "dump" && (
          <label style={fieldLabel}>
            Box holds
            <div style={{ marginTop: 4 }}>
              <Num ariaLabel="Box volume in cubic yards" value={t.capacityCuYd} onChange={(n) => setT({ ...t, capacityCuYd: n })} suffix="cu yd" width={90} />
            </div>
          </label>
        )}
      </div>
      {t.kind === "dump" && (
        <div style={{ fontSize: 13, color: C.grey }}>
          Box volume: length × width × side height in feet ÷ 27. A 7×14 box with 2 ft sides holds about 7 cu yd — but a 14k trailer&apos;s payload stops you near 5 tons of rock first.
        </div>
      )}
      <RowActions
        dirty={dirty}
        state={state}
        onSave={save}
        onRemove={async () => {
          if (await del(`/api/trailers/${t.id}`, t.name)) onRemoved(t.id);
        }}
        saveLabel="Save trailer"
      />
    </div>
  );
}

// ── machines ───────────────────────────────────────────────────────────────

export function MachineRow({
  machine,
  trailers,
  onSaved,
  onRemoved,
}: {
  machine: Machine;
  trailers: Trailer[];
  onSaved: (m: Machine) => void;
  onRemoved: (id: string) => void;
}) {
  const [m, setM] = useState(machine);
  const [state, setState] = useState("");
  const dirty = JSON.stringify(m) !== JSON.stringify(machine);

  async function save() {
    setState("saving");
    const { id, ...body } = m;
    const r = await patchJson<Machine>(`/api/equipment/${id}`, body, "equipment");
    if (!r.ok) return setState(r.error);
    onSaved(r.value);
    setState("saved");
  }

  return (
    <div style={rowBox}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label="Machine name" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} style={{ ...input, flex: "1 1 200px", fontWeight: 700 }} />
        <select aria-label="Machine type" value={m.kind} onChange={(e) => setM({ ...m, kind: e.target.value as Machine["kind"] })} style={{ ...input, width: 210 }}>
          {Object.entries(MACHINE_WORD).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={fieldLabel}>
          Burns
          <div style={{ marginTop: 4 }}>
            <select aria-label="Machine fuel" value={m.fuel} onChange={(e) => setM({ ...m, fuel: e.target.value as Machine["fuel"] })} style={{ ...input, width: 230, maxWidth: "100%" }}>
              <option value="offroad">Off-road (dyed) diesel</option>
              <option value="diesel">Road diesel</option>
              <option value="gas">Gas</option>
            </select>
          </div>
        </label>
        <label style={fieldLabel}>
          Fuel an hour
          <div style={{ marginTop: 4 }}>
            <Num ariaLabel="Gallons per hour" value={m.galPerHour} onChange={(n) => setM({ ...m, galPerHour: n })} suffix="gal/hr" width={90} />
          </div>
        </label>
      </div>
      <div style={{ fontSize: 13, color: C.grey, marginTop: -4 }}>Typical: {TYPICAL_GPH[m.kind]}. Your own fuel receipts ÷ hour meter beat any rule of thumb.</div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={fieldLabel}>
          Gets to the job on
          <div style={{ marginTop: 4 }}>
            <select aria-label="Trailer it rides on" value={m.trailerId ?? ""} onChange={(e) => setM({ ...m, trailerId: e.target.value || null })} style={{ ...input, maxWidth: 320 }}>
              <option value="">Drives there / stays on site</option>
              {trailers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
        </label>
        {m.trailerId && (
          <label style={fieldLabel}>
            Round trips to haul it out and back
            <div style={{ marginTop: 4 }}>
              <Num ariaLabel="Round trips" step="1" value={m.haulTrips} onChange={(n) => setM({ ...m, haulTrips: Math.max(0, Math.round(n)) })} width={80} />
            </div>
          </label>
        )}
      </div>
      {m.trailerId && (
        <div style={{ fontSize: 13, color: C.grey, marginTop: -4 }}>
          1 = it goes out in the morning and comes back at night with the crew. 2 = dropped off and picked up on separate trips.
        </div>
      )}

      <label style={fieldLabel}>
        Notes for the estimator (optional)
        <input aria-label="Machine notes" value={m.notes} onChange={(e) => setM({ ...m, notes: e.target.value })} placeholder="e.g. 60 in bucket, won't fit through a 5 ft gate" style={{ ...input, marginTop: 4, fontWeight: 400 }} />
      </label>

      <RowActions
        dirty={dirty}
        state={state}
        onSave={save}
        onRemove={async () => {
          if (await del(`/api/equipment/${m.id}`, m.name)) onRemoved(m.id);
        }}
        saveLabel="Save machine"
      />
    </div>
  );
}
