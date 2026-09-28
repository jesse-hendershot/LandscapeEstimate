"use client";

/**
 * The line items: editable, with where each one comes from and what else could
 * do the same job.
 *
 * Under a line: how the quantity was worked out, and — when the substitute
 * engine found a cheaper-delivered equivalent — which material it replaced and
 * what that saved. "Other options" lists every same-group material priced
 * delivered to THIS job, so swapping quarries is one tap.
 */

import { Fragment, useEffect, useState } from "react";

import { C } from "../../theme";
import PriceTag from "../PriceTag";
import { fmt } from "./totals";
import type { LineAlternative, LineItem } from "./types";

function Cell({
  value,
  onChange,
  type = "text",
  prefix,
  width,
  label,
}: {
  value: string | number;
  onChange: (v: string) => void;
  type?: "text" | "number";
  prefix?: string;
  width: number;
  label: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", background: C.yellow, borderRadius: 6, minWidth: width }}>
      {prefix && <span style={{ fontSize: 15, color: "#888", paddingLeft: 8 }}>{prefix}</span>}
      <input
        aria-label={label}
        title={type === "text" ? String(value) : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        step={type === "number" ? "any" : undefined}
        inputMode={type === "number" ? "decimal" : undefined}
        style={{ fontSize: 17, color: C.black, background: "transparent", border: "none", outline: "none", padding: "10px 8px", width: "100%" }}
      />
    </div>
  );
}


/** Phones get stacked cards instead of a table that scrolls sideways. */
function useNarrow(px = 700): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const on = () => setNarrow(mq.matches);
    const t = setTimeout(on, 0);
    mq.addEventListener("change", on);
    return () => {
      clearTimeout(t);
      mq.removeEventListener("change", on);
    };
  }, [px]);
  return narrow;
}

const miles = (m: number | null | undefined, approx?: boolean) =>
  m === null || m === undefined ? "" : `${approx ? "~" : ""}${m < 10 ? m.toFixed(1) : Math.round(m)} mi`;

function Alternatives({
  item,
  onUse,
}: {
  item: LineItem;
  onUse: (alt: LineAlternative) => void;
}) {
  const [open, setOpen] = useState(false);
  const alts = item.alternatives ?? [];
  if (alts.length === 0) return null;
  const currentLanded = item.qty * item.low + (item.haul ?? 0);

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ border: "none", background: "none", color: C.green, fontWeight: 700, fontSize: 14, cursor: "pointer", padding: 0 }}
      >
        {open ? "▾" : "▸"} {alts.length} other option{alts.length === 1 ? "" : "s"} that do the same job
      </button>
      {open && (
        <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
          {alts.map((a) => {
            const diff = a.landed - currentLanded;
            return (
              <div
                key={a.materialId}
                style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", background: C.bg, borderRadius: 8, padding: "8px 10px", fontSize: 14 }}
              >
                <div style={{ flex: "1 1 240px" }}>
                  <div style={{ fontWeight: 700 }}>{a.material}</div>
                  <div style={{ color: C.grey }}>
                    {a.supplier || "Your catalog"}
                    {a.miles !== null && ` · ${miles(a.miles, a.milesApprox)}`} · {a.qty} {a.unit} @ ${fmt(a.unitCost)}
                  </div>
                  {a.priceSource && (
                    <div style={{ marginTop: 3 }}>
                      <PriceTag source={a.priceSource} label={a.priceLabel} small wrap />
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div>
                    ${fmt(a.materialCost)} + ${fmt(a.haul)} haul = <b>${fmt(a.landed)}</b>
                  </div>
                  <div style={{ color: diff > 0 ? C.red : C.green, fontWeight: 700 }}>
                    {diff > 0 ? `$${fmt(diff)} more` : diff < 0 ? `$${fmt(-diff)} less` : "same"} delivered
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onUse(a)}
                  style={{ background: "#fff", border: `2px solid ${C.green}`, color: C.green, fontWeight: 700, borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}
                >
                  Use this
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Why the server swapped the model's pick: cheaper delivered, or a real supplier price. */
function SwitchNote({ item }: { item: LineItem }) {
  if (!item.replaced) return null;
  if (item.saved) {
    return (
      <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>
        ✓ Closer option picked: replaces {item.replaced}, saves ${fmt(item.saved)} delivered
      </div>
    );
  }
  if (item.priceSource && item.priceSource !== "starter" && item.priceSource !== "research") {
    return (
      <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>
        ✓ Supplier&apos;s price used instead of the starter price for {item.replaced}
      </div>
    );
  }
  return null;
}

export default function EstimateTable({
  items,
  onChange,
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
}) {
  const update = (i: number, patch: Partial<LineItem>) => {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  const swap = (i: number, alt: LineAlternative) => {
    const cur = items[i];
    // The line being replaced becomes an alternative itself, so the swap can be undone.
    const back: LineAlternative | null = cur.materialId
      ? {
          materialId: cur.materialId,
          material: cur.material,
          supplier: cur.source,
          qty: cur.qty,
          unit: cur.unit,
          unitCost: cur.low,
          materialCost: Math.round(cur.qty * cur.low * 100) / 100,
          haul: cur.haul ?? 0,
          landed: Math.round((cur.qty * cur.low + (cur.haul ?? 0)) * 100) / 100,
          miles: cur.miles ?? null,
          milesApprox: Boolean(cur.milesApprox),
          source: cur.source,
          priceSource: cur.priceSource,
          priceLabel: cur.priceLabel,
        }
      : null;
    const others = (cur.alternatives ?? []).filter((a) => a.materialId !== alt.materialId);
    update(i, {
      material: alt.material,
      materialId: alt.materialId,
      fromCatalog: true,
      qty: alt.qty,
      unit: alt.unit,
      low: alt.unitCost,
      high: alt.unitCost,
      source: alt.supplier || "Your catalog",
      haul: alt.haul,
      miles: alt.miles,
      milesApprox: alt.milesApprox,
      basis: `Switched from ${cur.material}`,
      alternatives: back ? [back, ...others] : others,
      replaced: undefined,
      saved: undefined,
      priceSource: alt.priceSource,
      priceLabel: alt.priceLabel,
    });
  };

  /** A price typed here is the estimator's own, whatever it was before. */
  const setPrice = (i: number, patch: Pick<LineItem, "low"> | Pick<LineItem, "high">) =>
    update(i, { ...patch, priceSource: "manual", priceLabel: "Changed on this estimate" });

  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));

  const add = () =>
    onChange([...items, { material: "", qty: 1, unit: "each", low: 0, high: 0, source: "", kind: "material" }]);

  const num = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const narrow = useNarrow();

  if (narrow) {
    return (
      <div style={{ padding: 12, display: "grid", gap: 12 }}>
        {items.map((item, i) => (
          <div key={i} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <Cell label="Material" value={item.material} onChange={(v) => update(i, { material: v })} width={0} />
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove ${item.material}`}
                style={{ color: C.red, background: "transparent", border: "none", fontSize: 20, cursor: "pointer", padding: "0 6px" }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Cell label="Quantity" type="number" value={item.qty} onChange={(v) => update(i, { qty: num(v) })} width={0} />
              <Cell label="Unit" value={item.unit} onChange={(v) => update(i, { unit: v })} width={0} />
              <Cell label="Low price" type="number" prefix="$" value={item.low} onChange={(v) => setPrice(i, { low: num(v) })} width={0} />
              <Cell label="High price" type="number" prefix="$" value={item.high} onChange={(v) => setPrice(i, { high: num(v) })} width={0} />
            </div>
            <Cell label="Source" value={item.source} onChange={(v) => update(i, { source: v })} width={0} />
            {(item.miles !== undefined && item.miles !== null) || item.haul ? (
              <div style={{ fontSize: 13, color: C.grey }}>
                {miles(item.miles, item.milesApprox)}
                {item.haul ? ` · haul $${fmt(item.haul)}` : ""}
              </div>
            ) : null}
            {item.priceSource && (
              <div>
                <PriceTag source={item.priceSource} label={item.priceLabel} />
              </div>
            )}
            <SwitchNote item={item} />
            {item.basis && <div style={{ fontSize: 13, color: C.grey, lineHeight: 1.4 }}>{item.basis}</div>}
            <Alternatives item={item} onUse={(a) => swap(i, a)} />
          </div>
        ))}
        <button type="button" onClick={add} style={{ fontSize: 16, fontWeight: 700, color: C.green, background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
          + Add row
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
          <thead>
            <tr style={{ background: C.lgn, borderBottom: `2px solid ${C.green}` }}>
              {["Material", "Qty", "Unit", "Low $", "High $", "From", ""].map((h, i) => (
                <th key={i} style={{ fontSize: 15, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: C.green, padding: "12px 8px", textAlign: "left", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const extra = Boolean(item.basis || item.replaced || item.alternatives?.length);
              return (
                <Fragment key={i}>
                  <tr style={{ borderTop: "1px solid #eee", verticalAlign: "top" }}>
                    <td style={{ padding: "8px 6px 4px", minWidth: 280 }}>
                      <Cell label="Material" value={item.material} onChange={(v) => update(i, { material: v })} width={270} />
                    </td>
                    <td style={{ padding: "8px 6px 4px" }}>
                      <Cell label="Quantity" type="number" value={item.qty} onChange={(v) => update(i, { qty: num(v) })} width={70} />
                    </td>
                    <td style={{ padding: "8px 6px 4px" }}>
                      <Cell label="Unit" value={item.unit} onChange={(v) => update(i, { unit: v })} width={70} />
                    </td>
                    <td style={{ padding: "8px 6px 4px" }}>
                      <Cell label="Low price" type="number" prefix="$" value={item.low} onChange={(v) => setPrice(i, { low: num(v) })} width={84} />
                    </td>
                    <td style={{ padding: "8px 6px 4px" }}>
                      <Cell label="High price" type="number" prefix="$" value={item.high} onChange={(v) => setPrice(i, { high: num(v) })} width={84} />
                    </td>
                    <td style={{ padding: "8px 6px 4px", minWidth: 170 }}>
                      <Cell label="Source" value={item.source} onChange={(v) => update(i, { source: v })} width={160} />
                      {(item.miles !== undefined && item.miles !== null) || item.haul ? (
                        <div style={{ marginTop: 4, fontSize: 13, color: C.grey }}>
                          {miles(item.miles, item.milesApprox)}
                          {item.haul ? ` · haul $${fmt(item.haul)}` : ""}
                        </div>
                      ) : null}
                      {item.priceSource && (
                        <div style={{ marginTop: 4, maxWidth: 220 }}>
                          <PriceTag source={item.priceSource} label={item.priceLabel} small wrap />
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px 6px 4px" }}>
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        aria-label={`Remove ${item.material}`}
                        style={{ color: C.red, background: "transparent", border: "none", fontSize: 18, cursor: "pointer", padding: "10px 8px" }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                  {extra && (
                    <tr>
                      <td colSpan={7} style={{ padding: "0 12px 10px" }}>
                        <SwitchNote item={item} />
                        {item.basis && <div style={{ marginTop: 2, fontSize: 13, color: C.grey, lineHeight: 1.4 }}>{item.basis}</div>}
                        <Alternatives item={item} onUse={(a) => swap(i, a)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "8px 16px 12px" }}>
        <button type="button" onClick={add} style={{ fontSize: 16, fontWeight: 700, color: C.green, background: "transparent", border: "none", cursor: "pointer" }}>
          + Add row
        </button>
      </div>
    </div>
  );
}
