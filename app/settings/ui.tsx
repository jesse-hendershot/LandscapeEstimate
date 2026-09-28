"use client";

/** Shared pieces for the settings screen: styles and a forgiving number box. */

import { useState } from "react";

import { C } from "../theme";

export const card: React.CSSProperties = {
  background: "#fff",
  borderRadius: 14,
  border: `1px solid ${C.line}`,
  padding: 24,
  marginBottom: 20,
};
export const h2: React.CSSProperties = { fontSize: 22, fontWeight: 700, margin: "0 0 6px", color: C.green };
export const help: React.CSSProperties = { fontSize: 14, color: C.grey, margin: "0 0 16px", lineHeight: 1.5 };
export const label: React.CSSProperties = { display: "block", fontSize: 15, fontWeight: 700, marginBottom: 6 };
export const fieldLabel: React.CSSProperties = { fontSize: 14, fontWeight: 700 };
export const input: React.CSSProperties = {
  fontSize: 17,
  padding: "10px 12px",
  border: "2px solid #d1d5db",
  borderRadius: 8,
  width: "100%",
  background: "#fff",
  boxSizing: "border-box",
};
export const btn: React.CSSProperties = {
  background: C.green,
  color: "#fff",
  fontSize: 17,
  fontWeight: 700,
  padding: "12px 22px",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
};
export const addBtn: React.CSSProperties = {
  marginTop: 14,
  background: "#fff",
  color: C.green,
  border: `2px solid ${C.green}`,
  fontSize: 16,
  fontWeight: 700,
  padding: "10px 18px",
  borderRadius: 10,
  cursor: "pointer",
};
export const rowBox: React.CSSProperties = {
  border: `1px solid ${C.line}`,
  borderRadius: 12,
  padding: 16,
  display: "grid",
  gap: 12,
};

export function Num({
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

/** Save / saved / error, and a Remove link, under each editable row. */
export function RowActions({
  dirty,
  state,
  onSave,
  onRemove,
  saveLabel,
}: {
  dirty: boolean;
  state: string;
  onSave: () => void;
  onRemove: () => void;
  saveLabel: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <button type="button" onClick={onSave} disabled={!dirty || state === "saving"} style={{ ...btn, padding: "8px 16px", fontSize: 15, opacity: dirty ? 1 : 0.5 }}>
        {state === "saving" ? "Saving…" : saveLabel}
      </button>
      {state === "saved" && !dirty && <span style={{ color: C.green, fontWeight: 700 }}>✓ Saved</span>}
      {state && state !== "saving" && state !== "saved" && <span style={{ color: C.red }}>{state}</span>}
      <button type="button" onClick={onRemove} style={{ marginLeft: "auto", border: "none", background: "none", color: C.red, fontWeight: 700, cursor: "pointer" }}>
        Remove
      </button>
    </div>
  );
}

/** PATCH a row and report the first validation message on failure. */
export async function patchJson<T>(url: string, body: unknown, key: string): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: (Object.values(data.fields ?? {})[0] as string) ?? data.error ?? "Couldn't save" };
    return { ok: true, value: data[key] as T };
  } catch {
    return { ok: false, error: "Network error — not saved" };
  }
}
