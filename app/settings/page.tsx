"use client";

/**
 * Settings: the handful of numbers that make hauling real.
 *
 * Shop address and trucks matter most — every estimate measures from the job
 * to each supplier and adds a round trip from the shop per truck. Trailers
 * size the loads; machines add their fuel and the trips to haul them out.
 * Everything else has a sensible default. All of it is editable here.
 */

import { useEffect, useState } from "react";

import { C } from "../theme";
import type { SettingsData } from "../components/estimate/types";
import { MachineRow, TrailerRow, TruckRow, type Machine, type Trailer, type Truck } from "./FleetRows";
import { addBtn, btn, card, h2, help, input, label, Num } from "./ui";

interface Price {
  centsPerGal: number;
  label: string;
  source: string;
}

interface Fuel {
  diesel: Price;
  gas: Price;
  offroad: Price;
}

export default function SettingsPage() {
  const [s, setS] = useState<SettingsData | null>(null);
  const [saved, setSaved] = useState<SettingsData | null>(null);
  const [fuel, setFuel] = useState<Fuel | null>(null);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [trailers, setTrailers] = useState<Trailer[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [a, b, c, d] = await Promise.all([fetch("/api/settings"), fetch("/api/trucks"), fetch("/api/trailers"), fetch("/api/equipment")]);
      if (a.ok) {
        const j = await a.json();
        setS(j.settings);
        setSaved(j.settings);
        setFuel(j.fuel);
      }
      if (b.ok) setTrucks((await b.json()).trucks);
      if (c.ok) setTrailers((await c.json()).trailers);
      if (d.ok) setMachines((await d.json()).equipment);
    })();
  }, []);

  if (!s) return <main style={{ padding: 40, fontSize: 18 }}>Loading settings…</main>;

  const set = <K extends keyof SettingsData>(k: K, v: SettingsData[K]) => setS({ ...s, [k]: v });
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);

  async function saveSettings() {
    if (!s || !saved) return;
    setBusy(true);
    setMsg(null);
    const patch: Record<string, unknown> = {};
    for (const k of Object.keys(s) as (keyof SettingsData)[]) {
      if (k === "shopLocated") continue;
      if (s[k] !== saved[k]) patch[k] = s[k];
    }
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const j = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: Object.values(j.fields ?? {})[0] as string ?? j.error ?? "Couldn't save" });
        return;
      }
      setS(j.settings);
      setSaved(j.settings);
      setFuel(j.fuel);
      setMsg(j.warning ? { kind: "warn", text: j.warning } : { kind: "ok", text: "✓ Settings saved" });
    } catch {
      setMsg({ kind: "err", text: "Network error — not saved" });
    } finally {
      setBusy(false);
    }
  }

  async function post<T>(url: string, body: unknown, key: string): Promise<T | null> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.ok ? ((await res.json())[key] as T) : null;
  }

  async function addTruck() {
    const truck = await post<Truck>(
      "/api/trucks",
      { name: "New truck", kind: "pickup", fuel: "diesel", trailerId: null, capacityTons: 1, capacityCuYd: 1, mpg: 12, costPerHour: 45 },
      "truck"
    );
    if (truck) setTrucks((t) => [...t, truck]);
  }

  async function addTrailer() {
    const trailer = await post<Trailer>("/api/trailers", { name: "New dump trailer", kind: "dump", capacityTons: 5, capacityCuYd: 4 }, "trailer");
    if (trailer) setTrailers((t) => [...t, trailer]);
  }

  async function addMachine() {
    const rides = trailers.find((t) => t.kind === "equipment") ?? null;
    const machine = await post<Machine>(
      "/api/equipment",
      { name: "New machine", kind: "skid_steer", fuel: "offroad", galPerHour: 3, trailerId: rides?.id ?? null, haulTrips: 1, notes: "" },
      "equipment"
    );
    if (machine) setMachines((m) => [...m, machine]);
  }

  const fuelBox = (key: "dieselOverride" | "gasOverride" | "offroadOverride", title: string, price: Price | undefined, blurb: string) => (
    <div style={{ display: "grid", gap: 6 }}>
      <span style={label}>{title}</span>
      {price && <span style={{ fontSize: 15 }}>This week: {price.label}</span>}
      <span style={{ fontSize: 13, color: C.grey }}>{blurb}</span>
      <label style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>
        Use my own price instead (0 = automatic)
        <div style={{ marginTop: 4 }}>
          <Num ariaLabel={`${title} price override`} value={s[key]} onChange={(n) => set(key, n)} suffix="$/gal" width={110} />
        </div>
      </label>
    </div>
  );

  return (
    <main style={{ flex: 1, background: C.bg }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 16px 80px" }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, margin: "0 0 20px" }}>⚙️ Settings</h1>

        <section style={card}>
          <h2 style={h2}>Your shop</h2>
          <p style={help}>Every job adds a round trip from here for each truck that goes out.</p>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <label>
                <span style={label}>Company name</span>
                <input value={s.companyName} onChange={(e) => set("companyName", e.target.value)} style={input} />
              </label>
              <label>
                <span style={label}>Your name</span>
                <input value={s.displayName} onChange={(e) => set("displayName", e.target.value)} style={input} />
              </label>
            </div>
            <label>
              <span style={label}>Shop address (where the trucks park)</span>
              <input value={s.shopAddress} onChange={(e) => set("shopAddress", e.target.value)} placeholder="123 Main St, Iowa City, IA" style={input} />
              <span style={{ fontSize: 14, marginTop: 6, display: "block", color: saved?.shopLocated ? C.green : C.red }}>
                {saved?.shopAddress ? (saved.shopLocated ? "✓ Found on the map" : "✗ Couldn't find this address on the map") : "Not set yet"}
              </span>
            </label>
          </div>
        </section>

        <section style={card}>
          <h2 style={h2}>Trailers</h2>
          <p style={help}>
            Add these first, then pick which truck pulls which. A dump trailer sets how much rock one trip carries; an equipment trailer is what a
            machine rides out on.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {trailers.map((t) => (
              <TrailerRow
                key={t.id}
                trailer={t}
                onSaved={(nt) => setTrailers((all) => all.map((x) => (x.id === nt.id ? nt : x)))}
                onRemoved={(id) => {
                  setTrailers((all) => all.filter((x) => x.id !== id));
                  setTrucks((all) => all.map((x) => (x.trailerId === id ? { ...x, trailerId: null } : x)));
                  setMachines((all) => all.map((x) => (x.trailerId === id ? { ...x, trailerId: null } : x)));
                }}
              />
            ))}
          </div>
          <button type="button" onClick={addTrailer} style={addBtn}>
            + Add a trailer
          </button>
        </section>

        <section style={card}>
          <h2 style={h2}>Trucks</h2>
          <p style={help}>
            Rock and dirt go in a dump truck or a truck pulling a dump trailer; bags, rolls and pipe are store runs in a pickup. The hourly cost is the
            truck and the driver&apos;s time — fuel is figured separately from the miles and this week&apos;s diesel or gas price.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {trucks.map((t) => (
              <TruckRow
                key={`${t.id}-${trailers.length}`}
                truck={t}
                trailers={trailers}
                onSaved={(nt) => setTrucks((all) => all.map((x) => (x.id === nt.id ? nt : x)))}
                onRemoved={(id) => setTrucks((all) => all.filter((x) => x.id !== id))}
              />
            ))}
          </div>
          <button type="button" onClick={addTruck} style={addBtn}>
            + Add a truck
          </button>
        </section>

        <section style={card}>
          <h2 style={h2}>Machines</h2>
          <p style={help}>
            Skid steers, excavators, tractors. Each estimate figures how many hours a job needs on each one, then counts the fuel it burns and the trips
            to haul it out. You can change the hours on any estimate.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {machines.map((m) => (
              <MachineRow
                key={`${m.id}-${trailers.length}`}
                machine={m}
                trailers={trailers}
                onSaved={(nm) => setMachines((all) => all.map((x) => (x.id === nm.id ? nm : x)))}
                onRemoved={(id) => setMachines((all) => all.filter((x) => x.id !== id))}
              />
            ))}
          </div>
          <button type="button" onClick={addMachine} style={addBtn}>
            + Add a machine
          </button>
        </section>

        <section style={card}>
          <h2 style={h2}>Fuel</h2>
          <p style={help}>Road diesel and gas update weekly from the government&apos;s Midwest retail prices. Put your own number in only if you pay something different.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 20 }}>
            {fuelBox("dieselOverride", "Road diesel", fuel?.diesel, "Diesel trucks' miles.")}
            {fuelBox("gasOverride", "Gas", fuel?.gas, "Gas trucks' miles, like an F-150.")}
            {fuelBox("offroadOverride", "Off-road diesel", fuel?.offroad, "The machines. Estimated as road diesel minus the road taxes dyed fuel doesn't pay.")}
          </div>
        </section>

        <section style={card}>
          <h2 style={h2}>How your trucks run</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16 }}>
            <label>
              <span style={label}>Average speed with a load</span>
              <Num ariaLabel="Average speed" value={s.avgMph} step="1" onChange={(n) => set("avgMph", Math.round(n))} suffix="mph" width={90} />
            </label>
            <label>
              <span style={label}>Time at the quarry + dumping, per load</span>
              <Num ariaLabel="Minutes per load" value={s.loadMinutes} step="1" onChange={(n) => set("loadMinutes", Math.round(n))} suffix="min" width={90} />
            </label>
            <label>
              <span style={label}>Time inside a store, per stop</span>
              <Num ariaLabel="Minutes per store stop" value={s.pickupStopMinutes} step="1" onChange={(n) => set("pickupStopMinutes", Math.round(n))} suffix="min" width={90} />
            </label>
            <label>
              <span style={label}>Trucks on a typical job</span>
              <Num ariaLabel="Trucks per job" value={s.trucksPerJob} step="1" onChange={(n) => set("trucksPerJob", Math.max(1, Math.round(n)))} width={90} />
            </label>
            <label>
              <span style={label}>If a supplier has no address, assume</span>
              <Num ariaLabel="Default miles" value={s.defaultHaulMiles} step="1" onChange={(n) => set("defaultHaulMiles", Math.round(n))} suffix="miles" width={90} />
            </label>
          </div>
        </section>

        <section style={card}>
          <h2 style={h2}>Tax and markup</h2>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <label>
                <span style={label}>Sales tax</span>
                <Num ariaLabel="Tax rate" value={s.taxRatePct} onChange={(n) => set("taxRatePct", n)} suffix="%" width={90} />
              </label>
              <label>
                <span style={label}>Default markup</span>
                <Num ariaLabel="Default markup" value={s.defaultMarkupPct} onChange={(n) => set("defaultMarkupPct", n)} suffix="%" width={90} />
              </label>
            </div>
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 16 }}>
              <input type="checkbox" checked={s.taxHaul} onChange={(e) => set("taxHaul", e.target.checked)} style={{ width: 22, height: 22 }} />
              Charge tax on hauling and machine fuel too
            </label>
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 16 }}>
              <input type="checkbox" checked={s.taxDeposits} onChange={(e) => set("taxDeposits", e.target.checked)} style={{ width: 22, height: 22 }} />
              Charge tax on pallet deposits (they&apos;re refundable, so usually not)
            </label>
            <p style={{ ...help, margin: 0 }}>Not tax advice — check with whoever does your books how Iowa treats your jobs.</p>
          </div>
        </section>

        <div style={{ position: "sticky", bottom: 16, display: "flex", gap: 14, alignItems: "center", background: "rgba(249,246,240,0.95)", padding: "12px 0" }}>
          <button type="button" onClick={saveSettings} disabled={!dirty || busy} style={{ ...btn, opacity: dirty ? 1 : 0.5 }}>
            {busy ? "Saving…" : "Save settings"}
          </button>
          {msg && <span style={{ fontWeight: 700, color: msg.kind === "ok" ? C.green : msg.kind === "warn" ? "#8a5a00" : C.red }}>{msg.text}</span>}
        </div>
      </div>
    </main>
  );
}
