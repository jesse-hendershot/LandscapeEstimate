"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { C, fmt, isStale, since } from "../theme";

/**
 * The catalog screen.
 *
 * One interaction dominates everything else here: correcting a price. The
 * estimator sits down with a supplier invoice and goes down the list — click,
 * type, tab, next. So prices save on blur with no save button, the row shows
 * what happened, and a failure puts the old number back rather than leaving a
 * wrong one on screen looking saved.
 *
 * Every edit is optimistic. A catalog that feels slow to correct is a catalog
 * that stops getting corrected, and then the pricing is wrong everywhere.
 */

const UNITS = [
  "cu yd", "ton", "sq ft", "linear ft", "each", "bag", "roll", "pack", "bottle",
] as const;

const CATEGORIES = [
  "mulch", "soil", "aggregate", "sod", "hardscape",
  "edging", "fabric", "hardware", "amendment", "plant", "other",
] as const;

export interface CatalogMaterial {
  id: string;
  name: string;
  category: string;
  unit: string;
  unitCost: number;
  supplier: string;
  supplierLocation: string;
  sku: string | null;
  coverage: string;
  notes: string;
  isActive: boolean;
  useCount: number;
  priceUpdatedAt: string;
}

type RowState = "idle" | "saving" | "saved" | "error";

const inputBase: React.CSSProperties = {
  width: "100%",
  border: "1px solid transparent",
  background: "transparent",
  padding: "5px 6px",
  fontSize: 13,
  fontFamily: "inherit",
  color: C.black,
  borderRadius: 3,
};

export default function CatalogTable({ initial }: { initial: CatalogMaterial[] }) {
  const [rows, setRows] = useState<CatalogMaterial[]>(initial);
  const [state, setState] = useState<Record<string, RowState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const flash = useCallback((id: string, s: RowState, msg = "") => {
    setState((p) => ({ ...p, [id]: s }));
    setErrors((p) => ({ ...p, [id]: msg }));
    clearTimeout(timers.current[id]);
    if (s === "saved") {
      timers.current[id] = setTimeout(
        () => setState((p) => ({ ...p, [id]: "idle" })),
        1400
      );
    }
  }, []);

  const save = useCallback(
    async (id: string, patch: Partial<CatalogMaterial>) => {
      const before = rows.find((r) => r.id === id);
      if (!before) return;

      // Optimistic: the row updates now, and only rolls back if the write fails.
      setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      flash(id, "saving");

      try {
        const res = await fetch(`/api/catalog/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const data = await res.json();

        if (!res.ok) {
          setRows((p) => p.map((r) => (r.id === id ? before : r)));
          const field = data.fields ? Object.values(data.fields)[0] : null;
          flash(id, "error", String(field ?? data.error ?? "Could not save"));
          return;
        }
        setRows((p) => p.map((r) => (r.id === id ? data.material : r)));
        flash(id, "saved");
      } catch {
        setRows((p) => p.map((r) => (r.id === id ? before : r)));
        flash(id, "error", "Network error — not saved");
      }
    },
    [rows, flash]
  );

  const remove = useCallback(
    async (id: string) => {
      const before = rows;
      setRows((p) => p.filter((r) => r.id !== id));
      try {
        const res = await fetch(`/api/catalog/${id}`, { method: "DELETE" });
        if (!res.ok) setRows(before);
      } catch {
        setRows(before);
      }
    },
    [rows]
  );

  const add = useCallback(
    async (draft: Partial<CatalogMaterial>) => {
      try {
        const res = await fetch("/api/catalog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        const data = await res.json();
        if (!res.ok) return String(data.error ?? "Could not add");
        setRows((p) => [data.material, ...p]);
        setAdding(false);
        return null;
      } catch {
        return "Network error";
      }
    },
    []
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.supplier.toLowerCase().includes(q)
    );
  }, [rows, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogMaterial[]>();
    for (const r of filtered) {
      map.set(r.category, [...(map.get(r.category) ?? []), r]);
    }
    // Categories by how much the shop uses them, not alphabetically — the
    // things bought every week should be at the top of the page.
    return [...map.entries()].sort(
      (a, b) =>
        b[1].reduce((s, r) => s + r.useCount, 0) -
        a[1].reduce((s, r) => s + r.useCount, 0)
    );
  }, [filtered]);

  const staleCount = rows.filter((r) => isStale(r.priceUpdatedAt)).length;

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 20px 64px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 6,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.015em" }}>
          Your materials
        </h1>
        <span style={{ fontSize: 13, color: C.grey }}>
          {rows.length} material{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <p style={{ fontSize: 14, color: C.grey, margin: "0 0 18px", maxWidth: "62ch" }}>
        These prices are used exactly as written on every estimate. Nothing gets
        researched or guessed for anything on this list, so keeping it current is
        the whole job.
      </p>

      {staleCount > 0 && (
        <div
          style={{
            background: C.yellow,
            border: `1px solid ${C.amber}`,
            borderRadius: 4,
            padding: "10px 12px",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          <strong>{staleCount}</strong> price{staleCount === 1 ? " is" : "s are"} more
          than 60 days old. Those are the ones most likely to be wrong.
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name, category or supplier"
          style={{
            flex: "1 1 260px",
            border: `1px solid ${C.line}`,
            borderRadius: 4,
            padding: "8px 10px",
            fontSize: 14,
            background: C.white,
          }}
        />
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          style={{
            background: adding ? C.white : C.green,
            color: adding ? C.green : C.white,
            border: `1px solid ${C.green}`,
            borderRadius: 4,
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {adding ? "Cancel" : "Add material"}
        </button>
      </div>

      {adding && <AddRow onAdd={add} />}

      {grouped.length === 0 && (
        <p style={{ color: C.grey, fontSize: 14, padding: "24px 0" }}>
          {query ? "Nothing matches that filter." : "No materials yet."}
        </p>
      )}

      {grouped.map(([category, items]) => (
        <section key={category} style={{ marginTop: 26 }}>
          <h2
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: C.green,
              margin: "0 0 6px",
            }}
          >
            {category}
          </h2>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                minWidth: 1000,
                borderCollapse: "collapse",
                background: C.white,
                border: `1px solid ${C.line}`,
                borderRadius: 4,
                fontSize: 13,
                tableLayout: "fixed",
              }}
            >
              <thead>
                <tr style={{ background: C.lgn }}>
                  <Th style={{ width: "22%" }}>Material</Th>
                  <Th style={{ width: 92 }}>Unit</Th>
                  <Th style={{ width: 118, textAlign: "right" }}>Your price</Th>
                  <Th style={{ width: "14%" }}>Supplier</Th>
                  {/* Coverage gets the slack. It is the longest field and the
                      one that was colliding with its neighbour. */}
                  <Th style={{ width: "auto" }}>Coverage</Th>
                  <Th style={{ width: 116, textAlign: "right", paddingLeft: 16 }}>
                    Price set
                  </Th>
                  <Th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <Row
                    key={m.id}
                    m={m}
                    state={state[m.id] ?? "idle"}
                    error={errors[m.id] ?? ""}
                    onSave={save}
                    onRemove={remove}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

// ── row ────────────────────────────────────────────────────────────────────

function Row({
  m,
  state,
  error,
  onSave,
  onRemove,
}: {
  m: CatalogMaterial;
  state: RowState;
  error: string;
  onSave: (id: string, patch: Partial<CatalogMaterial>) => void;
  onRemove: (id: string) => void;
}) {
  const [price, setPrice] = useState(String(m.unitCost));
  const [confirming, setConfirming] = useState(false);
  const stale = isStale(m.priceUpdatedAt);

  // Keep the field in step when the server returns a normalized value.
  const displayPrice = state === "saving" ? price : String(m.unitCost);

  const commitPrice = () => {
    const next = parseFloat(price);
    if (!Number.isFinite(next) || next === m.unitCost) {
      setPrice(String(m.unitCost));
      return;
    }
    onSave(m.id, { unitCost: next });
  };

  const rowBg =
    state === "error" ? "#FDEDEA" : state === "saved" ? C.lgn : undefined;

  return (
    <>
      <tr style={{ borderTop: `1px solid ${C.line}`, background: rowBg }}>
        <Td>
          <TextCell
            value={m.name}
            onCommit={(v) => v !== m.name && onSave(m.id, { name: v })}
          />
        </Td>

        <Td>
          <select
            value={m.unit}
            onChange={(e) => onSave(m.id, { unit: e.target.value })}
            style={{ ...inputBase, border: `1px solid ${C.line}`, background: C.white }}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Td>

        <Td style={{ textAlign: "right" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <span style={{ color: C.grey, fontSize: 13 }}>$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={displayPrice}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={commitPrice}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setPrice(String(m.unitCost));
              }}
              style={{
                ...inputBase,
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
                border: `1px solid ${stale ? C.amber : C.line}`,
                background: C.white,
              }}
            />
          </div>
        </Td>

        <Td>
          <TextCell
            value={m.supplier}
            placeholder="who you buy from"
            onCommit={(v) => v !== m.supplier && onSave(m.id, { supplier: v })}
          />
        </Td>

        <Td>
          <TextCell
            value={m.coverage}
            placeholder="e.g. 1 cu yd covers 100 sq ft at 3 in"
            onCommit={(v) => v !== m.coverage && onSave(m.id, { coverage: v })}
          />
        </Td>

        <Td style={{ textAlign: "right", paddingLeft: 16, whiteSpace: "nowrap" }}>
          <span style={{ fontSize: 12, color: stale ? C.red : C.grey }}>
            {since(m.priceUpdatedAt)}
          </span>
        </Td>

        <Td>
          {confirming ? (
            <span style={{ display: "flex", gap: 4 }}>
              <button
                type="button"
                onClick={() => onRemove(m.id)}
                title="Confirm remove"
                style={miniBtn(C.red)}
              >
                ✓
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                title="Keep"
                style={miniBtn(C.grey)}
              >
                ✕
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              title="Remove from catalog"
              style={miniBtn(C.grey)}
            >
              ✕
            </button>
          )}
        </Td>
      </tr>

      {state === "error" && error && (
        <tr style={{ background: "#FDEDEA" }}>
          <td colSpan={7} style={{ padding: "4px 10px 8px", fontSize: 12, color: C.red }}>
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

// ── add form ───────────────────────────────────────────────────────────────

function AddRow({
  onAdd,
}: {
  onAdd: (draft: Partial<CatalogMaterial>) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [unit, setUnit] = useState<string>("cu yd");
  const [unitCost, setUnitCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [coverage, setCoverage] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cost = parseFloat(unitCost);
    if (!name.trim() || !Number.isFinite(cost) || cost <= 0) {
      setErr("Name and a price above zero are required.");
      return;
    }
    setBusy(true);
    const problem = await onAdd({ name: name.trim(), category, unit, unitCost: cost, supplier, coverage });
    setBusy(false);
    if (problem) setErr(problem);
  };

  const field: React.CSSProperties = {
    border: `1px solid ${C.line}`,
    borderRadius: 4,
    padding: "8px 10px",
    fontSize: 13,
    background: C.white,
    fontFamily: "inherit",
  };

  return (
    <form
      onSubmit={submit}
      style={{
        background: C.white,
        border: `1px solid ${C.green}`,
        borderRadius: 4,
        padding: 14,
        display: "grid",
        gap: 10,
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        alignItems: "end",
        marginBottom: 8,
      }}
    >
      <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
        <span style={labelStyle}>Material name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} style={field} autoFocus />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span style={labelStyle}>Category</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={field}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span style={labelStyle}>Unit</span>
        <select value={unit} onChange={(e) => setUnit(e.target.value)} style={field}>
          {UNITS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span style={labelStyle}>Your price</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={unitCost}
          onChange={(e) => setUnitCost(e.target.value)}
          style={{ ...field, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span style={labelStyle}>Supplier</span>
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)} style={field} />
      </label>

      <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
        <span style={labelStyle}>Coverage (helps quantity math)</span>
        <input
          value={coverage}
          onChange={(e) => setCoverage(e.target.value)}
          placeholder="1 cu yd covers ~100 sq ft at 3 in"
          style={field}
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        style={{
          background: C.green,
          color: C.white,
          border: "none",
          borderRadius: 4,
          padding: "9px 18px",
          fontSize: 14,
          fontWeight: 600,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Adding…" : "Add"}
      </button>

      {err && (
        <p style={{ gridColumn: "1 / -1", margin: 0, color: C.red, fontSize: 13 }}>{err}</p>
      )}
    </form>
  );
}

// ── small pieces ───────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: C.grey,
};

function TextCell({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  return (
    <input
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setV(value);
      }}
      style={inputBase}
      onFocus={(e) => (e.target.style.border = `1px solid ${C.green}`)}
      onBlurCapture={(e) => (e.target.style.border = "1px solid transparent")}
    />
  );
}

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 10px",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: C.grey,
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: "3px 6px", verticalAlign: "middle", ...style }}>{children}</td>;
}

function miniBtn(color: string): React.CSSProperties {
  return {
    border: "none",
    background: "transparent",
    color,
    cursor: "pointer",
    fontSize: 13,
    padding: "4px 6px",
    lineHeight: 1,
  };
}

export { fmt };
