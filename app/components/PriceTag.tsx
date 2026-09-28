/**
 * Where a price came from, as a small tag. The estimator should be able to tell
 * at a glance whether a number is the quarry's own or a placeholder.
 */

import { C } from "../theme";

type Look = { icon: string; text: string; fg: string; bg: string; border: string };

export function priceLook(source: string | undefined, label?: string, short = false): Look | null {
  switch (source) {
    case "sheet":
      return { icon: "📄", text: label || "Supplier price sheet", fg: C.green, bg: C.lgn, border: "rgba(45,106,79,0.25)" };
    case "receipt":
      return { icon: "🧾", text: label || "From a receipt", fg: C.green, bg: C.lgn, border: "rgba(45,106,79,0.25)" };
    case "manual":
      return { icon: "✎", text: label || "Your price", fg: C.black, bg: "#f3f4f6", border: "#e5e7eb" };
    case "starter":
      return { icon: "⚠", text: short ? "Starter price" : "Starter price — not from a supplier", fg: "#8a5a00", bg: "#FFF4E0", border: "rgba(244,162,49,0.5)" };
    case "research":
      return { icon: "🔎", text: short ? "Looked up online" : "Looked up online — not your supplier", fg: "#1e3a8a", bg: "#EEF2FF", border: "#c7d2fe" };
    default:
      return null;
  }
}

export default function PriceTag({ source, label, small, wrap }: { source?: string; label?: string; small?: boolean; wrap?: boolean }) {
  const look = priceLook(source, label, small);
  if (!look) return null;
  return (
    <span
      title={label || look.text}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: small ? 12 : 13,
        fontWeight: 700,
        color: look.fg,
        background: look.bg,
        border: `1px solid ${look.border}`,
        borderRadius: wrap ? 8 : 999,
        padding: small ? "1px 8px" : "2px 10px",
        maxWidth: "100%",
        whiteSpace: wrap ? "normal" : "nowrap",
        lineHeight: 1.35,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      <span aria-hidden>{look.icon}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{look.text}</span>
    </span>
  );
}
