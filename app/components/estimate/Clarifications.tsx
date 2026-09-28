"use client";

/**
 * Follow-up questions after an estimate, answered with taps instead of typing
 * where possible: yes/no buttons, either/or choices, number boxes. The answers
 * re-run the whole estimate (same gates, same locality math) rather than
 * patching lines.
 */

import { C } from "../../theme";

export type ClarType = "yesno" | "choice" | "number" | "text";

export function parseClar(q: string): { type: ClarType; choices?: string[] } {
  // 0. The model tags plain yes/no questions: "Restore sod over the trench, yes or no?"
  if (/,?\s*\(?\s*yes\s*(?:or|\/)\s*no\s*\)?\s*\??\s*$/i.test(q)) return { type: "yesno" };

  // 1. "X vs Y" anywhere in the question → choice
  const vsMatch =
    q.match(/\(([^)]{2,35})\s+vs\.?\s+([^)]{2,35})\)/i) ||
    q.match(/\b(#\d[\w\s/-]{0,20})\s+vs\.?\s+(#\d[\w\s/-]{0,20})\b/i) ||
    q.match(/\b([\w][\w\s/-]{1,20})\s+vs\.?\s+([\w][\w\s/-]{1,20})\b/i);
  if (vsMatch) {
    const c1 = vsMatch[1].trim();
    const c2 = vsMatch[2].replace(/[,;.].*$/, "").trim();
    if (c1.length < 40 && c2.length < 40) return { type: "choice", choices: [c1, c2] };
  }

  // 2. "pickup or delivery", "plastic or steel", known keyword pairs → choice
  const knownPairRe = /\b(pickup|plastic|bagged|standard|cedar|2-gal|1-gal|#\d+|yes|no)\b.*?\bor\b.*?\b(delivery|steel|aluminum|bulk|premium|pine|3-gal|2-gal|#\d+)\b/i;
  if (knownPairRe.test(q)) {
    const idx = q.search(/\bor\b/i);
    const opt1 = q.slice(0, idx).split(/[,;:(]/g).pop()?.replace(/\s*\([^)]*\)\s*$/, "").trim() ?? "";
    const opt2 = q.slice(idx + 3).split(/[,;:)?]/g)[0]?.replace(/\s*\([^)]*\)/g, "").trim() ?? "";
    if (opt1.length > 1 && opt1.length < 55 && opt2.length > 1 && opt2.length < 55)
      return { type: "choice", choices: [opt1, opt2] };
  }

  // 3. "confirm whether X or Y" → choice
  if (/confirm\s+(whether|if)/i.test(q) && /\bor\b/i.test(q)) {
    const m = q.match(/(?:whether|if)\s+(.+?)\s+or\s+(.+?)(?:\s*[—–\-;,.]|$)/i);
    if (m) {
      const o1 = m[1].replace(/\([^)]*\)/g, "").trim();
      const o2 = m[2].replace(/\([^)]*\)/g, "").replace(/[,;.].*$/, "").trim();
      if (o1.length < 65 && o2.length < 65 && o1.length > 1 && o2.length > 1)
        return { type: "choice", choices: [o1, o2] };
    }
  }

  // 3b. Plain yes/no question: "Does the drain need an emitter?"
  if (/^(does|do|is|are|will|should|can|would|has|have)\b/i.test(q.trim()) && !/\bor\b/i.test(q))
    return { type: "yesno" };

  // 3c. Short either/or: "Plastic or steel edging?"
  const orParts = q.replace(/\?\s*$/, "").split(/\s+or\s+/i);
  if (orParts.length === 2 && q.length < 90 && !/\bhow\s+(many|much|long|wide|deep)\b/i.test(q)) {
    const lead = orParts[0].split(/[,:;]/).pop()!.trim().split(/\s+/);
    // Drop question scaffolding ("Do you want", "Is it") from the first option.
    while (lead.length > 1 && /^(do|does|you|want|would|like|is|it|are|they|will|use|should|we|the|a|an)$/i.test(lead[0])) lead.shift();
    const o2Words = orParts[1].trim().split(/\s+/).slice(0, 5);
    const o2 = o2Words.join(" ").replace(/[,;.]$/, "");
    // Mirror the second option's length: "restored with sod or seed" -> sod / seed.
    const o1 = lead.slice(-Math.max(1, Math.min(4, o2Words.length))).join(" ");
    if (o1.length > 1 && o2.length > 1) return { type: "choice", choices: [o1, o2] };
  }

  // 4. "confirm whether" without "or" → yes/no. Not for "How deep should the
  // trench be?" — a how/what question wants a value, whatever verbs it uses.
  if (
    /\b(confirm\s+whether|needs?\s+(an?\s+)?topsoil|needs?\s+(an?\s+)?amendment|do\s+you\s+want|should\s+(the|we)\b)/i.test(q) &&
    !/\bor\b/i.test(q) &&
    !/^\s*(how|what|which|where|when)\b/i.test(q)
  )
    return { type: "yesno" };

  // 5. Numeric question
  if (/\b(how\s+many|how\s+much|how\s+(wide|deep|tall|long|large)|what\s+(size|depth|width|height|quantity)|number\s+of|sq(?:uare)?\s*f(?:ee)?t|linear\s*f(?:ee)?t)\b/i.test(q))
    return { type: "number" };

  return { type: "text" };
}


// ── Input for one question ─────────────────────────────────────────────────

export function ClarificationInput({
  question, index, value, onChange,
}: {
  question: string; index: number; value: string; onChange: (v: string) => void;
}) {
  const { type, choices } = parseClar(question);
  const inputStyle: React.CSSProperties = {
    fontSize: 18, color: C.black, border: `2px solid #d1d5db`,
    borderRadius: 8, padding: "12px 16px", outline: "none",
    transition: "border-color 0.15s",
  };

  return (
    <div style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid #f0f0f0" }}>
      <p style={{ fontSize: 17, fontWeight: "bold", color: C.black, marginBottom: 14, lineHeight: 1.55, marginTop: 0 }}>
        {question}
      </p>

      {type === "yesno" && (
        <div style={{ display: "flex", gap: 12 }}>
          {["Yes", "No"].map(opt => (
            <button key={opt} type="button" onClick={() => onChange(opt)} style={{
              padding: "12px 32px", fontSize: 18, fontWeight: "bold", borderRadius: 10,
              border: `2px solid ${value === opt ? C.green : "#d1d5db"}`,
              backgroundColor: value === opt ? C.green : "#fff",
              color: value === opt ? "#fff" : C.black,
              cursor: "pointer", transition: "all 0.15s",
            }}>
              {opt}
            </button>
          ))}
        </div>
      )}

      {type === "choice" && choices && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {choices.map(opt => (
            <label key={opt} style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "13px 18px", borderRadius: 10, cursor: "pointer",
              border: `2px solid ${value === opt ? C.green : "#d1d5db"}`,
              backgroundColor: value === opt ? C.lgn : "#fff",
              fontSize: 17, fontWeight: value === opt ? "bold" : "normal",
              transition: "all 0.15s",
            }}>
              <input
                type="radio" name={`clar-${index}`} value={opt}
                checked={value === opt} onChange={() => onChange(opt)}
                style={{ accentColor: C.green, width: 20, height: 20, cursor: "pointer" }}
              />
              {opt}
            </label>
          ))}
        </div>
      )}

      {type === "number" && (
        <input
          type="number" value={value} onChange={e => onChange(e.target.value)}
          placeholder="Enter value…"
          style={{ ...inputStyle, width: 200 }}
        />
      )}

      {type === "text" && (
        <input
          type="text" value={value} onChange={e => onChange(e.target.value)}
          placeholder="Type your answer…"
          style={{ ...inputStyle, width: "100%", maxWidth: 520 }}
        />
      )}
    </div>
  );
}
