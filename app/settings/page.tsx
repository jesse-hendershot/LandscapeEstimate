"use client";

/**
 * Settings: the handful of numbers that make hauling real.
 *
 * Shop address and trucks matter most — every estimate measures from the job
 * to each supplier and adds a round trip from the shop per truck. Everything
 * else has a sensible default.
 */

import { useEffect, useState } from "react";

import { C } from "../theme";
import type { SettingsData } from "../components/estimate/types";

interface Truck {
  id: string;
  name: string;
  kind: "dump" | "pickup";
  capacityTons: number;
  capacityCuYd: number;
  mpg: number;
  costPerHour: number;
}

interface Diesel {
  centsPerGal: number;
  label: string;
  source: string;
}

const card: React.CSSProperties = {
  background: "#fff",
  borderRadius: 14,
  border: `1px solid ${C.line}`,
  padding: 24,
  marginBottom: 20,
};
const h2: React.CSSProperties = { fontSize: 22, fontWeight: 700, margin: "0 0 6px", color: C.green };
const help: React.CSSProperties = { fontSize: 14, color: C.grey, margin: "0 0 16px", lineHeight: 1.5 };
const label: React.CSSProperties = { display: "block", fontSize: 15, fontWeight: 700, marginBottom: 6 };
const input: React.CSSProperties = {
  fontSize: 17,
  padding: "10px 12px",
  border: "2px solid #d1d5db",
  borderRadius: 8,
  width: "100%",
  background: "#fff",
  boxSizing: "border-box",
};
const btn: React.CSSProperties = {
  background: C.green,
  color: "#fff",
  fontSize: 17,
  fontWeight: 700,
  padding: "12px 22px",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
};

function Num({
  value,
  onChange,
  step = "any",
  suffix,
  width = 140,
  ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: string;
  suffix?: string;
  width?: number;
  ariaLabel: string;
}) {
  const [text, setText] = useState(String(value));
  const [last, setLast] = useState(value);
  // Follow outside changes (e.g. after a save) without fighting the typist.
  if (value !== last) {
    setLast(value);
    setText(String(value));
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        type="number"
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={{ ...input, width }}
      />
      {suffix && <span style={{ fontSize: 15, color: C.grey }}>{suffix}</span>}
    </span>
  );
}

function TruckRow({ truck, onSaved, onRemoved }: { truck: Truck; onSaved: (t: Truck) => void; onRemoved: (id: string) => void }) {
  const [t, setT] = useState(truck);
  const [state, setState] = useState<"" | "saving" | "saved" | string>("");
  const dirty = JSON.stringify(t) !== JSON.stringify(truck);

  async function save() {
    setState("saving");
    const res = await fetch(`/api/trucks/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: t.name, kind: t.kind, capacityTons: t.capacityTons, capacityCuYd: t.capacityCuYd, mpg: t.mpg, costPerHour: t.costPerHour }),
    });
    const data = await res.json();
    if (!res.ok) {
      setState(Object.values(data.fields ?? {})[0] as string ?? data.error ?? "Couldn't save");
      return;
    }
    onSaved(data.truck);
    setState("saved");
  }

  async function remove() {
    if (!confirm(`Remove "${t.name}"?`)) return;
    const res = await fetch(`/api/trucks/${t.id}`, { method: "DELETE" });
    if (res.ok) onRemoved(t.id);
  }

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label="Truck name" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} style={{ ...input, flex: "1 1 220px", fontWeight: 700 }} />
        <select aria-label="Truck type" value={t.kind} onChange={(e) => setT({ ...t, kind: e.target.value as Truck["kind"] })} style={{ ...input, width: 190 }}>
          <option value="dump">Dump truck (bulk)</option>
          <option value="pickup">Pickup (store runs)</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <label style={{ fontSize: 14, fontWeight: 700 }}>
          Carries
          <div style={{ marginTop: 4 }}>
            <Num ariaLabel="Capacity in tons" value={t.capacityTons} onChange={(n) => setT({ ...t, capacityTons: n })} suffix="tons" width={90} />
          </div>
        </label>
        <label style={{ fontSize: 14, fontWeight: 700 }}>
          Bed holds
          <div style={{ marginTop: 4 }}>
            <Num ariaLabel="Capacity in cubic yards" value={t.capacityCuYd} onChange={(n) => setT({ ...t, capacityCuYd: n })} suffix="cu yd" width={90} />
          </div>
        </label>
        <label style={{ fontSize: 14, fontWeight: 700 }}>
          Gets
          <div style={{ marginTop: 4 }}>
            <Num ariaLabel="Miles per gallon" value={t.mpg} onChange={(n) => setT({ ...t, mpg: n })} suffix="mpg" width={80} />
          </div>
        </label>
        <label style={{ fontSize: 14, fontWeight: 700 }}>
          Truck + driver, per hour (not fuel)
          <div style={{ marginTop: 4 }}>
            <Num ariaLabel="Cost per hour" value={t.costPerHour} onChange={(n) => setT({ ...t, costPerHour: n })} suffix="$/hr" width={100} />
          </div>
        </label>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={!dirty || state === "saving"} style={{ ...btn, padding: "8px 16px", fontSize: 15, opacity: dirty ? 1 : 0.5 }}>
          {state === "saving" ? "Saving…" : "Save truck"}
        </button>
        {state === "saved" && !dirty && <span style={{ color: C.green, fontWeight: 700 }}>✓ Saved</span>}
        {state && state !== "saving" && state !== "saved" && <span style={{ color: C.red }}>{state}</span>}
        <button type="button" onClick={remove} style={{ marginLeft: "auto", border: "none", background: "none", color: C.red, fontWeight: 700, cursor: "pointer" }}>
          Remove
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [s, setS] = useState<SettingsData | null>(null);
  const [saved, setSaved] = useState<SettingsData | null>(null);
  const [diesel, setDiesel] = useState<Diesel | null>(null);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [a, b] = await Promise.all([fetch("/api/settings"), fetch("/api/trucks")]);
      if (a.ok) {
        const j = await a.json();
        setS(j.settings);
        setSaved(j.settings);
        setDiesel(j.diesel);
      }
      if (b.ok) setTrucks((await b.json()).trucks);
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
      setDiesel(j.diesel);
      setMsg(j.warning ? { kind: "warn", text: j.warning } : { kind: "ok", text: "✓ Settings saved" });
    } catch {
      setMsg({ kind: "err", text: "Network error — not saved" });
    } finally {
      setBusy(false);
    }
  }

  async function addTruck() {
    const res = await fetch("/api/trucks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New truck", kind: "dump", capacityTons: 7, capacityCuYd: 5, mpg: 8, costPerHour: 60 }),
    });
    if (res.ok) {
      const { truck } = await res.json();
      setTrucks((t) => [...t, truck]);
    }
  }

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
          <h2 style={h2}>Trucks</h2>
          <p style={help}>
            Bulk rock and dirt ride the dump trucks; bags, rolls and pipe are store runs in the pickup. The hourly cost is the truck and the driver&apos;s
            time — fuel is figured separately from the miles and this week&apos;s diesel.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {trucks.map((t) => (
              <TruckRow
                key={t.id}
                truck={t}
                onSaved={(nt) => setTrucks((all) => all.map((x) => (x.id === nt.id ? nt : x)))}
                onRemoved={(id) => setTrucks((all) => all.filter((x) => x.id !== id))}
              />
            ))}
          </div>
          <button type="button" onClick={addTruck} style={{ marginTop: 14, background: "#fff", color: C.green, border: `2px solid ${C.green}`, fontSize: 16, fontWeight: 700, padding: "10px 18px", borderRadius: 10, cursor: "pointer" }}>
            + Add a truck
          </button>
        </section>

        <section style={card}>
          <h2 style={h2}>Diesel</h2>
          <p style={help}>Updated weekly from the government&apos;s Midwest retail diesel price. Put your own number in only if you buy fuel on a fixed contract.</p>
          {diesel && <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>This week: {diesel.label}</div>}
          <label>
            <span style={label}>Use my own price instead (0 = automatic)</span>
            <Num ariaLabel="Diesel price override" value={s.dieselOverride} onChange={(n) => set("dieselOverride", n)} suffix="$/gal" />
          </label>
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
              Charge tax on hauling too
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
