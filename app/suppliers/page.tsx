"use client";

/**
 * Suppliers: the places the rock comes from, and where they are.
 *
 * Location is the point. A supplier with an address can be priced on distance
 * to every job; one without gets an assumed distance and a warning. The quarry
 * finder lists every active quarry and gravel pit from federal mine records
 * near the shop (or any address), including the ones nobody's heard of.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { C } from "../theme";

interface Supplier {
  id: string;
  name: string;
  kind: string;
  address: string;
  phone: string;
  notes: string;
  deliveryFee: number;
  located: boolean;
  mshaId: string | null;
  milesFromShop: number | null;
  materialCount: number;
}

interface Quarry {
  id: string;
  name: string;
  operator: string;
  state: string;
  county: string;
  lat: number;
  lng: number;
  kind: "limestone" | "sand_gravel" | "stone";
  active: boolean;
  town: string;
  directions: string;
  crowMiles: number;
  roadMilesApprox: number;
  supplierId: string | null;
}

const KINDS: Record<string, string> = {
  quarry: "Quarry / pit",
  yard: "Landscape yard",
  big_box: "Big-box store",
  nursery: "Nursery",
  sod_farm: "Sod farm",
  other: "Other",
};

const QKIND: Record<Quarry["kind"], string> = {
  limestone: "Crushed limestone",
  sand_gravel: "Sand & gravel",
  stone: "Stone",
};

const card: React.CSSProperties = { background: "#fff", borderRadius: 14, border: `1px solid ${C.line}`, padding: 20, marginBottom: 20 };
const input: React.CSSProperties = { fontSize: 16, padding: "10px 12px", border: "2px solid #d1d5db", borderRadius: 8, width: "100%", background: "#fff", boxSizing: "border-box" };
const btn: React.CSSProperties = { background: C.green, color: "#fff", fontSize: 16, fontWeight: 700, padding: "10px 18px", borderRadius: 10, border: "none", cursor: "pointer" };
const ghost: React.CSSProperties = { background: "#fff", color: C.green, border: `2px solid ${C.green}`, fontSize: 15, fontWeight: 700, padding: "8px 14px", borderRadius: 10, cursor: "pointer" };

function SupplierCard({ s, onChanged, onRemoved }: { s: Supplier; onChanged: (s: Supplier) => void; onRemoved: (id: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState(s);
  const [msg, setMsg] = useState("");

  async function save() {
    setMsg("");
    const res = await fetch(`/api/suppliers/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: d.name, kind: d.kind, address: d.address, phone: d.phone, notes: d.notes, deliveryFee: d.deliveryFee }),
    });
    const j = await res.json();
    if (!res.ok) return setMsg(j.error ?? "Couldn't save");
    onChanged({ ...j.supplier, materialCount: s.materialCount });
    setMsg(j.warning ?? "");
    setEdit(false);
  }

  async function remove() {
    if (!confirm(`Remove ${s.name}? Materials priced from it stay in your catalog.`)) return;
    const res = await fetch(`/api/suppliers/${s.id}`, { method: "DELETE" });
    if (res.ok) onRemoved(s.id);
  }

  if (!edit) {
    return (
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: "1 1 260px" }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{s.name}</div>
          <div style={{ fontSize: 14, color: C.grey }}>
            {KINDS[s.kind] ?? s.kind}
            {s.address ? ` · ${s.address}` : ""}
            {s.phone ? ` · ${s.phone}` : ""}
          </div>
          <div style={{ fontSize: 13, marginTop: 4, color: s.located ? C.green : C.red }}>
            {s.located ? `📍 on the map${s.milesFromShop !== null ? ` · ${s.milesFromShop} mi from the shop (straight line)` : ""}` : "✗ no location — add an address"}
            {s.deliveryFee > 0 && <span style={{ color: C.grey }}> · delivers for ${s.deliveryFee.toFixed(2)}</span>}
          </div>
          {msg && <div style={{ fontSize: 13, color: "#8a5a00" }}>{msg}</div>}
        </div>
        <span style={{ fontSize: 14, color: C.grey }}>{s.materialCount} material{s.materialCount === 1 ? "" : "s"}</span>
        <button type="button" style={ghost} onClick={() => setEdit(true)}>
          Edit
        </button>
      </div>
    );
  }

  return (
    <div style={{ border: `2px solid ${C.green}`, borderRadius: 12, padding: 14, display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <input aria-label="Name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} style={input} />
        <select aria-label="Kind" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })} style={input}>
          {Object.entries(KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <input aria-label="Address" placeholder="Street address, town" value={d.address} onChange={(e) => setD({ ...d, address: e.target.value })} style={input} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <input aria-label="Phone" placeholder="Phone" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} style={input} />
        <label style={{ fontSize: 14 }}>
          Delivery fee if they deliver ($)
          <input aria-label="Delivery fee" type="number" value={d.deliveryFee} onChange={(e) => setD({ ...d, deliveryFee: parseFloat(e.target.value) || 0 })} style={input} />
        </label>
      </div>
      <input aria-label="Notes" placeholder="Notes (hours, who to call, minimums…)" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} style={input} />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" style={btn} onClick={save}>
          Save
        </button>
        <button type="button" style={ghost} onClick={() => { setD(s); setEdit(false); }}>
          Cancel
        </button>
        <button type="button" onClick={remove} style={{ marginLeft: "auto", border: "none", background: "none", color: C.red, fontWeight: 700, cursor: "pointer" }}>
          Remove
        </button>
      </div>
      {msg && <div style={{ color: C.red }}>{msg}</div>}
    </div>
  );
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", kind: "yard", address: "", phone: "" });
  const [addMsg, setAddMsg] = useState("");

  const [near, setNear] = useState("");
  const [radius, setRadius] = useState(30);
  const [quarries, setQuarries] = useState<Quarry[] | null>(null);
  const [qLabel, setQLabel] = useState("");
  const [qErr, setQErr] = useState("");
  const [qBusy, setQBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/suppliers");
    if (res.ok) setSuppliers((await res.json()).suppliers);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function add() {
    setAddMsg("");
    const res = await fetch("/api/suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    const j = await res.json();
    if (!res.ok) return setAddMsg(Object.values(j.fields ?? {})[0] as string ?? j.error ?? "Couldn't add");
    setSuppliers((s) => [...(s ?? []), { ...j.supplier, materialCount: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
    setDraft({ name: "", kind: "yard", address: "", phone: "" });
    setAdding(false);
    if (j.warning) setAddMsg(j.warning);
  }

  async function findQuarries() {
    setQBusy(true);
    setQErr("");
    try {
      const qs = new URLSearchParams({ radius: String(radius) });
      if (near.trim()) qs.set("address", near.trim());
      const res = await fetch(`/api/quarries?${qs}`);
      const j = await res.json();
      if (!res.ok) {
        setQErr(j.error ?? "Couldn't search");
        setQuarries(null);
        return;
      }
      setQuarries(j.quarries);
      setQLabel(j.centerLabel);
    } finally {
      setQBusy(false);
    }
  }

  async function addQuarry(q: Quarry) {
    const res = await fetch("/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: q.name.replace(/\s+/g, " ").trim(),
        kind: "quarry",
        address: `${q.town}, ${q.state}`,
        lat: q.lat,
        lng: q.lng,
        mshaId: q.id,
        notes: `${q.operator}. ${QKIND[q.kind]}. ${q.directions}`.slice(0, 600),
      }),
    });
    const j = await res.json();
    if (!res.ok) {
      setQErr(j.error ?? "Couldn't add");
      return;
    }
    setSuppliers((s) => [...(s ?? []), { ...j.supplier, materialCount: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
    setQuarries((qs) => qs?.map((x) => (x.id === q.id ? { ...x, supplierId: j.supplier.id } : x)) ?? null);
  }

  return (
    <main style={{ flex: 1, background: C.bg }}>
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "28px 16px 80px" }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, margin: "0 0 6px" }}>🏗️ Suppliers</h1>
        <p style={{ fontSize: 16, color: C.grey, margin: "0 0 20px" }}>
          Where your materials come from. Link each material to its supplier on the <Link href="/catalog" style={{ color: C.green, fontWeight: 700 }}>Materials</Link> page so every estimate
          can compare them by what they cost delivered to the job.
        </p>

        <section style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: C.green }}>Your suppliers</h2>
            {!adding && (
              <button type="button" style={{ ...btn, marginLeft: "auto" }} onClick={() => setAdding(true)}>
                + Add a supplier
              </button>
            )}
          </div>
          {adding && (
            <div style={{ border: `2px solid ${C.green}`, borderRadius: 12, padding: 14, display: "grid", gap: 10, marginBottom: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                <input aria-label="Supplier name" placeholder="Name, e.g. Menards – Iowa City" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={input} />
                <select aria-label="Kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} style={input}>
                  {Object.entries(KINDS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <input aria-label="Address" placeholder="Street address, town" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} style={input} />
              <input aria-label="Phone" placeholder="Phone (optional)" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} style={input} />
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" style={btn} onClick={add}>
                  Add
                </button>
                <button type="button" style={ghost} onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {addMsg && <div style={{ color: "#8a5a00", marginBottom: 10 }}>{addMsg}</div>}
          {suppliers === null ? (
            <div>Loading…</div>
          ) : suppliers.length === 0 ? (
            <div style={{ color: C.grey }}>No suppliers yet. Add the places you buy from, or find quarries below.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {suppliers.map((s) => (
                <SupplierCard
                  key={s.id}
                  s={s}
                  onChanged={(n) => setSuppliers((all) => all?.map((x) => (x.id === n.id ? n : x)) ?? null)}
                  onRemoved={(id) => setSuppliers((all) => all?.filter((x) => x.id !== id) ?? null)}
                />
              ))}
            </div>
          )}
        </section>

        <section style={card}>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px", color: C.green }}>🪨 Find quarries and gravel pits</h2>
          <p style={{ fontSize: 14, color: C.grey, margin: "0 0 14px", lineHeight: 1.5 }}>
            Every active quarry and sand &amp; gravel pit registered with the federal Mine Safety and Health Administration. Locations are what the operators reported —
            call to confirm hours and prices before counting on one.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <input aria-label="Search near address" placeholder="Near your shop — or type a job address" value={near} onChange={(e) => setNear(e.target.value)} style={{ ...input, flex: "1 1 280px" }} />
            <select aria-label="Radius" value={radius} onChange={(e) => setRadius(+e.target.value)} style={{ ...input, width: 130 }}>
              {[15, 30, 50, 75].map((r) => (
                <option key={r} value={r}>
                  within {r} mi
                </option>
              ))}
            </select>
            <button type="button" style={btn} onClick={findQuarries} disabled={qBusy}>
              {qBusy ? "Searching…" : "Search"}
            </button>
          </div>
          {qErr && <div style={{ color: C.red, marginBottom: 10 }}>{qErr}</div>}
          {quarries && (
            <>
              <div style={{ fontSize: 14, color: C.grey, marginBottom: 10 }}>
                {quarries.length} within {radius} mi of {qLabel}
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {quarries.map((q) => (
                  <div key={q.id} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ minWidth: 70, textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{q.roadMilesApprox}</div>
                      <div style={{ fontSize: 12, color: C.grey }}>~road mi</div>
                    </div>
                    <div style={{ flex: "1 1 300px" }}>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{q.name}</div>
                      <div style={{ fontSize: 14, color: C.grey }}>
                        {q.operator} · {QKIND[q.kind]} · {q.town}, {q.state} · {q.active ? "active" : "intermittent"}
                      </div>
                      {q.directions && <div style={{ fontSize: 13, color: C.grey, marginTop: 2 }}>{q.directions}</div>}
                    </div>
                    <a href={`https://www.google.com/maps/search/?api=1&query=${q.lat},${q.lng}`} target="_blank" rel="noreferrer" style={{ fontSize: 14, color: C.green, fontWeight: 700 }}>
                      Map ↗
                    </a>
                    {q.supplierId ? (
                      <span style={{ fontSize: 14, color: C.green, fontWeight: 700 }}>✓ Added</span>
                    ) : (
                      <button type="button" style={ghost} onClick={() => addQuarry(q)}>
                        + Add as supplier
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
