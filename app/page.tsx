"use client";

import { useState, useEffect, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

interface RefineUpdate extends LineItem {
  action: "update" | "add" | "remove";
}

interface LineItem {
  material: string;
  qty: number;
  unit: string;
  low: number;
  high: number;
  source: string;
}

interface Estimate {
  line_items: LineItem[];
  total_low: number;
  total_high: number;
  clarifications_needed: string[];
  notes: string;
}

interface SavedEstimate {
  id: string;
  contractorName: string;
  jobAddress: string;
  dateGenerated: string;
  lineItems: LineItem[];
  grandTotalLow: number;
  grandTotalHigh: number;
  markupPct: number;
}

interface Profile {
  name: string;
  defaultMarkup: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const C = {
  green:  "#2D6A4F",
  amber:  "#F4A231",
  bg:     "#F9F6F0",
  black:  "#1A1A1A",
  red:    "#C0392B",
  yellow: "#FFFDE7",
  lgn:    "#F0F7F4",
} as const;

const LOADING_MSGS = [
  "🔍 Searching for local suppliers near you...",
  "📐 Calculating material quantities...",
  "💵 Looking up current prices in your area...",
  "🌿 Putting your estimate together...",
  "Almost there — double-checking the math...",
];

// ── Helpers ────────────────────────────────────────────────────────────────

const isDelivery   = (i: LineItem) => /delivery/i.test(i.material);
const isTax        = (i: LineItem) => /sales.?tax|iowa.*tax/i.test(i.material);
const isGrandTotal = (i: LineItem) => /grand.?total/i.test(i.material);
const isSpecial    = (i: LineItem) => isDelivery(i) || isTax(i) || isGrandTotal(i);

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Clarification parsing ──────────────────────────────────────────────────

type ClarType = "yesno" | "choice" | "number" | "text";

function parseClar(q: string): { type: ClarType; choices?: string[] } {
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
    const opt2 = q.slice(idx + 3).split(/[,;:)]/g)[0]?.replace(/\s*\([^)]*\)/g, "").trim() ?? "";
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

  // 4. "confirm whether" without "or" → yes/no
  if (/\b(confirm\s+whether|needs?\s+(an?\s+)?topsoil|needs?\s+(an?\s+)?amendment|do\s+you\s+want|should\s+(the|we)\b)/i.test(q) && !/\bor\b/i.test(q))
    return { type: "yesno" };

  // 5. Numeric question
  if (/\b(how\s+many|how\s+much|how\s+(wide|deep|tall|long|large)|what\s+(size|depth|width|height|quantity)|number\s+of|sq(?:uare)?\s*f(?:ee)?t|linear\s*f(?:ee)?t)\b/i.test(q))
    return { type: "number" };

  return { type: "text" };
}

// ── Sub-components ─────────────────────────────────────────────────────────

function EditCell({
  value, onChange, type = "text", prefix, wide,
}: {
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  prefix?: string;
  wide?: boolean;
}) {
  return (
    <td style={{ padding: "4px 6px", minWidth: wide ? 180 : type === "number" ? 78 : 90 }}>
      <div style={{ display: "flex", alignItems: "center", backgroundColor: C.yellow, borderRadius: 6 }}>
        {prefix && (
          <span style={{ fontSize: 15, color: "#888", paddingLeft: 8, userSelect: "none" }}>
            {prefix}
          </span>
        )}
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          type={type}
          step={type === "number" ? "0.01" : undefined}
          style={{
            fontSize: 17, color: C.black, backgroundColor: "transparent",
            border: "none", outline: "none", padding: "10px 8px", width: "100%",
          }}
        />
      </div>
    </td>
  );
}

function TotalRow({
  label, low, high, source, grand,
}: {
  label: string; low: number; high: number; source?: string; grand?: boolean;
}) {
  const bg  = grand ? C.green : C.bg;
  const col = grand ? "#fff"   : C.black;
  const fs  = grand ? 24 : 18;
  return (
    <tr style={{ backgroundColor: bg, borderBottom: grand ? "none" : "1px solid #e5e7eb" }}>
      <td colSpan={3} style={{ padding: "14px 20px", fontSize: fs, fontWeight: "bold", color: col }}>
        {label}
      </td>
      <td style={{ padding: "14px 12px", fontSize: fs, fontWeight: "bold", color: col, whiteSpace: "nowrap" }}>
        ${fmt(low)}
      </td>
      <td style={{ padding: "14px 12px", fontSize: fs, fontWeight: "bold", color: col, whiteSpace: "nowrap" }}>
        ${fmt(high)}
      </td>
      <td style={{ padding: "14px 12px", fontSize: 13, color: grand ? "rgba(255,255,255,0.6)" : "#999", maxWidth: 160, wordBreak: "break-word" }}>
        {source}
      </td>
      <td />
    </tr>
  );
}

function StatBox({
  label, value, variant = "neutral",
}: {
  label: string; value: string; variant?: "neutral" | "highlight" | "primary";
}) {
  const bg = variant === "primary" ? C.green : variant === "highlight" ? "#FFF9E6" : C.bg;
  const border = variant === "primary" ? "none" : variant === "highlight" ? `2px solid ${C.amber}` : "2px solid #e5e7eb";
  const valCol = variant === "primary" ? "#fff" : C.black;
  const lblCol = variant === "primary" ? "rgba(255,255,255,0.8)" : "#666";
  return (
    <div style={{ backgroundColor: bg, border, borderRadius: 12, padding: "20px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 14, fontWeight: "bold", color: lblCol, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: variant === "primary" ? 26 : 22, fontWeight: "bold", color: valCol }}>
        {value}
      </div>
    </div>
  );
}

function ClarificationInput({
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

// ── Main Component ─────────────────────────────────────────────────────────

export default function Home() {
  // Profile
  const [profile, setProfile]           = useState<Profile | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [profileName, setProfileName]   = useState("");
  const [profileMrk, setProfileMrk]     = useState(35);
  const [showBanner, setShowBanner]     = useState(false);

  // Saved estimates
  const [saved, setSaved]           = useState<SavedEstimate[]>([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [deleteId, setDeleteId]       = useState<string | null>(null);

  // Form
  const [contractor, setContractor]     = useState("");
  const [address, setAddress]           = useState("");
  const [description, setDescription]   = useState("");

  // Estimate
  const [estimate, setEstimate]         = useState<Estimate | null>(null);
  const [items, setItems]               = useState<LineItem[]>([]);
  const [loading, setLoading]           = useState(false);
  const [msgIdx, setMsgIdx]             = useState(0);
  const [msgVisible, setMsgVisible]     = useState(true);
  const [error, setError]               = useState("");
  const [showNewConfirm, setShowNewConfirm] = useState(false);
  const [markup, setMarkup]             = useState(35);
  const [copied, setCopied]             = useState(false);
  const [clarAnswers, setClarAnswers]   = useState<Record<number, string>>({});
  const [refining, setRefining]         = useState(false);
  const [refineMsg, setRefineMsg]       = useState("");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Bootstrap ──

  useEffect(() => {
    try {
      const p = localStorage.getItem("le_profile");
      if (p) {
        const parsed = JSON.parse(p) as Profile;
        setProfile(parsed);
        setContractor(parsed.name);
        setMarkup(parsed.defaultMarkup);
        setProfileName(parsed.name);
        setProfileMrk(parsed.defaultMarkup);
      } else {
        setShowBanner(true);
      }
      const s = localStorage.getItem("le_saved");
      if (s) setSaved(JSON.parse(s));
    } catch {}
  }, []);

  // ── Loading animation ──

  useEffect(() => {
    if (loading) {
      setMsgIdx(0);
      setMsgVisible(true);
      intervalRef.current = setInterval(() => {
        setMsgVisible(false);
        setTimeout(() => {
          setMsgIdx(i => (i + 1) % LOADING_MSGS.length);
          setMsgVisible(true);
        }, 300);
      }, 2000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [loading]);

  // ── Derived totals ──

  const matItems = items.filter(i => !isSpecial(i));
  const delItem  = items.find(isDelivery);

  const subLow  = matItems.reduce((s, i) => s + i.qty * i.low, 0);
  const subHigh = matItems.reduce((s, i) => s + i.qty * i.high, 0);
  const delLow  = delItem ? delItem.qty * delItem.low : 0;
  const delHigh = delItem ? delItem.qty * delItem.high : 0;
  // Recalculate tax live (ignores AI row which may be stale after edits)
  const taxLow  = (subLow  + delLow)  * 0.07;
  const taxHigh = (subHigh + delHigh) * 0.07;
  const grandLow  = subLow  + delLow  + taxLow;
  const grandHigh = subHigh + delHigh + taxHigh;
  const midpoint  = (grandLow + grandHigh) / 2;
  const mrkAmt    = midpoint * (markup / 100);
  const custQuote = midpoint + mrkAmt;

  useEffect(() => {
    if (!estimate) return;
    console.table({
      subtotal:   { low: subLow.toFixed(2),   high: subHigh.toFixed(2) },
      delivery:   { low: delLow.toFixed(2),   high: delHigh.toFixed(2) },
      tax:        { low: taxLow.toFixed(2),   high: taxHigh.toFixed(2) },
      grandTotal: { low: grandLow.toFixed(2), high: grandHigh.toFixed(2) },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subLow, subHigh, delLow, delHigh, taxLow, taxHigh, grandLow, grandHigh]);

  // ── Actions ──

  async function runEstimate() {
    if (!address || !description) return;
    setLoading(true);
    setError("");
    setEstimate(null);
    setItems([]);
    try {
      const res  = await fetch("/api/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractorName: contractor, jobAddress: address, jobDescription: description }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went wrong"); return; }
      setEstimate(data);
      setItems(data.line_items);
      setClarAnswers({});
      setRefineMsg("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) { e.preventDefault(); runEstimate(); }

  function updateItem(idx: number, field: keyof LineItem, val: string | number) {
    setItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  }

  function addRow() {
    setItems(prev => [...prev, { material: "", qty: 1, unit: "", low: 0, high: 0, source: "" }]);
  }

  function removeRow(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  function handleStartNew() {
    if (estimate) { setShowNewConfirm(true); return; }
    doReset();
  }

  function doReset() {
    setEstimate(null); setItems([]); setError(""); setShowNewConfirm(false);
  }

  function saveEstimate() {
    const entry: SavedEstimate = {
      id: Date.now().toString(),
      contractorName: contractor,
      jobAddress: address,
      dateGenerated: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      lineItems: items,
      grandTotalLow: grandLow,
      grandTotalHigh: grandHigh,
      markupPct: markup,
    };
    const updated = [entry, ...saved];
    setSaved(updated);
    try { localStorage.setItem("le_saved", JSON.stringify(updated)); } catch {}
  }

  function loadSaved(s: SavedEstimate) {
    setContractor(s.contractorName);
    setAddress(s.jobAddress);
    setMarkup(s.markupPct);
    setItems(s.lineItems);
    setEstimate({ line_items: s.lineItems, total_low: s.grandTotalLow, total_high: s.grandTotalHigh, clarifications_needed: [], notes: "" });
    setShowSidebar(false);
  }

  function doDelete(id: string) {
    const updated = saved.filter(e => e.id !== id);
    setSaved(updated);
    try { localStorage.setItem("le_saved", JSON.stringify(updated)); } catch {}
    setDeleteId(null);
  }

  function saveProfile() {
    const p: Profile = { name: profileName, defaultMarkup: profileMrk };
    setProfile(p);
    try { localStorage.setItem("le_profile", JSON.stringify(p)); } catch {}
    setContractor(profileName);
    setMarkup(profileMrk);
    setShowSettings(false);
    setShowBanner(false);
  }

  async function downloadPDF() {
    const { default: jsPDF }    = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 40;

    // Header bar
    doc.setFillColor(45, 106, 79);
    doc.rect(0, 0, W, 72, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(28); doc.setFont("helvetica", "bold");
    doc.text("LandscapeEstimate", M, 44);
    doc.setFontSize(11); doc.setFont("helvetica", "normal");
    const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    doc.text(`${contractor ? contractor + "  ·  " : ""}${dateStr}`, M, 62);

    let y = 94;
    doc.setTextColor(26, 26, 26);
    doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text("Job Address:", M, y);
    doc.setFont("helvetica", "normal");
    doc.text(address, M + 100, y);
    y += 30;

    // Materials table
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("Itemized Materials", M, y);
    y += 10;

    autoTable(doc, {
      startY: y,
      head: [["Material", "Qty", "Unit", "Low $", "High $", "Source"]],
      body: matItems.map(i => [i.material, i.qty, i.unit, `$${fmt(i.low)}`, `$${fmt(i.high)}`, i.source]),
      margin: { left: M, right: M },
      styles: { fontSize: 10, cellPadding: 6, textColor: [26, 26, 26] as [number,number,number] },
      headStyles: { fillColor: [45, 106, 79] as [number,number,number], textColor: [255, 255, 255] as [number,number,number], fontStyle: "bold", fontSize: 11 },
      alternateRowStyles: { fillColor: [249, 246, 240] as [number,number,number] },
      columnStyles: {
        1: { halign: "right", cellWidth: 35 },
        2: { cellWidth: 52 },
        3: { halign: "right", cellWidth: 55 },
        4: { halign: "right", cellWidth: 55 },
      },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;

    // Subtotals
    autoTable(doc, {
      startY: y,
      body: [
        ["Subtotal",            "", "", `$${fmt(subLow)}`, `$${fmt(subHigh)}`, ""],
        ["Delivery (est.)",     "", "", `$${fmt(delLow)}`, `$${fmt(delHigh)}`, delItem?.source || ""],
        ["Iowa Sales Tax (7%)", "", "", `$${fmt(taxLow)}`, `$${fmt(taxHigh)}`, "Iowa state sales tax"],
      ],
      margin: { left: M, right: M },
      styles: { fontSize: 11, cellPadding: 6, textColor: [26, 26, 26] as [number,number,number], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [249, 246, 240] as [number,number,number] },
      columnStyles: {
        1: { cellWidth: 35 },
        2: { cellWidth: 52 },
        3: { halign: "right", cellWidth: 55 },
        4: { halign: "right", cellWidth: 55 },
      },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    // Grand total row
    autoTable(doc, {
      startY: y,
      body: [["GRAND TOTAL", "", "", `$${fmt(grandLow)}`, `$${fmt(grandHigh)}`, ""]],
      margin: { left: M, right: M },
      bodyStyles: {
        fillColor: [45, 106, 79] as [number,number,number],
        textColor: [255, 255, 255] as [number,number,number],
        fontStyle: "bold", fontSize: 14, cellPadding: 10,
      },
      columnStyles: {
        1: { cellWidth: 35 },
        2: { cellWidth: 52 },
        3: { halign: "right", cellWidth: 55 },
        4: { halign: "right", cellWidth: 55 },
      },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
    if (y > H - 220) { doc.addPage(); y = 40; }

    // Quote section
    doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(26, 26, 26);
    doc.text("Suggested Customer Quote", M, y); y += 18;
    doc.setFontSize(11); doc.setFont("helvetica", "normal");
    doc.text(`Markup applied: ${markup}%`, M, y); y += 15;
    doc.text(`Materials cost (midpoint): $${fmt(midpoint)}`, M, y); y += 15;
    doc.text(`Markup amount: $${fmt(mrkAmt)}`, M, y); y += 15;
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(45, 106, 79);
    doc.text(`Charge the customer: $${fmt(custQuote)}`, M, y); y += 28;
    doc.setTextColor(26, 26, 26);

    // Clarifications
    if (estimate?.clarifications_needed?.length) {
      if (y > H - 140) { doc.addPage(); y = 40; }
      doc.setFontSize(13); doc.setFont("helvetica", "bold");
      doc.text("Clarifications Needed", M, y); y += 16;
      doc.setFontSize(10); doc.setFont("helvetica", "normal");
      for (const c of estimate.clarifications_needed) {
        const lines = doc.splitTextToSize(`• ${c}`, W - M * 2);
        if (y + lines.length * 14 > H - 55) { doc.addPage(); y = 40; }
        doc.text(lines, M, y);
        y += lines.length * 14 + 4;
      }
      y += 8;
    }

    // Notes
    if (estimate?.notes) {
      if (y > H - 100) { doc.addPage(); y = 40; }
      doc.setFontSize(13); doc.setFont("helvetica", "bold"); doc.setTextColor(26, 26, 26);
      doc.text("Notes", M, y); y += 16;
      doc.setFontSize(10); doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(estimate.notes, W - M * 2);
      doc.text(lines, M, y);
    }

    // Footer on every page
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFillColor(249, 246, 240);
      doc.rect(0, H - 36, W, 36, "F");
      doc.setFontSize(8); doc.setFont("helvetica", "italic"); doc.setTextColor(120, 120, 120);
      doc.text(
        "Materials estimate only — prices subject to change. Valid 30 days from generation date. Produced by LandscapeEstimate.",
        M, H - 14
      );
      doc.text(`Page ${p} of ${totalPages}`, W - M, H - 14, { align: "right" });
    }

    doc.save(`estimate-${address.replace(/[^a-z0-9]/gi, "-")}.pdf`);
  }

  async function copyToClipboard() {
    const rows = [
      `LandscapeEstimate — ${contractor || "Contractor"}`,
      `Job: ${address}`, "",
      ["Material", "Qty", "Unit", "Low $", "High $", "Source"].join("\t"),
      ...matItems.map(i => [i.material, i.qty, i.unit, `$${fmt(i.low)}`, `$${fmt(i.high)}`, i.source].join("\t")),
      "",
      `Subtotal\t\t\t$${fmt(subLow)}\t$${fmt(subHigh)}`,
      `Delivery\t\t\t$${fmt(delLow)}\t$${fmt(delHigh)}`,
      `Iowa Sales Tax (7%)\t\t\t$${fmt(taxLow)}\t$${fmt(taxHigh)}`,
      `GRAND TOTAL\t\t\t$${fmt(grandLow)}\t$${fmt(grandHigh)}`,
    ];
    await navigator.clipboard.writeText(rows.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function refineEstimate() {
    const answered = (estimate?.clarifications_needed ?? [])
      .map((q, i) => clarAnswers[i] ? `Q: ${q}\nA: ${clarAnswers[i]}` : null)
      .filter(Boolean)
      .join("\n\n");
    if (!answered) return;

    setRefining(true);
    setRefineMsg("");
    try {
      const res = await fetch("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineItems: items.filter(i => !isSpecial(i)),
          answers: answered,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setRefineMsg("Refinement failed: " + data.error); return; }

      if (data.updates?.length > 0) {
        setItems(prev => {
          let next = [...prev];
          for (const upd of data.updates as RefineUpdate[]) {
            if (upd.action === "remove") {
              next = next.filter(i => i.material !== upd.material);
            } else if (upd.action === "add") {
              const delIdx = next.findIndex(isDelivery);
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { action: _a, ...item } = upd;
              delIdx >= 0 ? next.splice(delIdx, 0, item) : next.push(item);
            } else {
              const idx = next.findIndex(i => i.material === upd.material);
              if (idx >= 0) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { action: _a, ...item } = upd;
                next[idx] = item;
              }
            }
          }
          return next;
        });
      }

      setRefineMsg(data.notes || "Estimate updated based on your answers.");
    } catch {
      setRefineMsg("Could not connect to the refinement service.");
    } finally {
      setRefining(false);
    }
  }

  // ── Style tokens ──

  const inputBase: React.CSSProperties = {
    fontSize: 18, color: C.black, backgroundColor: "#fff",
    border: "2px solid #d1d5db", borderRadius: 8,
    padding: "14px 16px", width: "100%", minHeight: 52,
    outline: "none", boxSizing: "border-box",
  };
  const labelBase: React.CSSProperties = {
    fontSize: 20, fontWeight: "bold", color: C.black, display: "block", marginBottom: 8,
  };
  const btnGreen: React.CSSProperties = {
    backgroundColor: C.green, color: "#fff", fontSize: 20, fontWeight: "bold",
    padding: "14px 28px", borderRadius: 10, border: "none", cursor: "pointer",
  };
  const btnAmber: React.CSSProperties = {
    backgroundColor: C.amber, color: C.black, fontSize: 20, fontWeight: "bold",
    padding: "14px 28px", borderRadius: 10, border: "none", cursor: "pointer",
  };

  const hasEstimate = !!(estimate && items.length > 0);

  // ── Saved panel (shared between sidebar and mobile drawer) ──

  const SavedPanel = () => (
    <>
      <h2 style={{ fontSize: 20, fontWeight: "bold", color: C.green, marginTop: 0, marginBottom: 16 }}>
        📋 Past Jobs
      </h2>
      {saved.length === 0 ? (
        <p style={{ fontSize: 16, color: "#777", lineHeight: 1.7, textAlign: "center", marginTop: 20 }}>
          No saved jobs yet.<br />Generate your first estimate<br />and hit Save! 🌱
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
          {saved.map(s => (
            <div key={s.id} style={{ border: "2px solid #e5e7eb", borderRadius: 10, padding: 14, backgroundColor: C.bg }}>
              <div style={{ fontSize: 15, fontWeight: "bold", color: C.black, marginBottom: 2 }}>{s.jobAddress}</div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>{s.dateGenerated}</div>
              <div style={{ fontSize: 15, fontWeight: "bold", color: C.green, marginBottom: 10 }}>
                ${fmt(s.grandTotalLow)} – ${fmt(s.grandTotalHigh)}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => loadSaved(s)}
                  style={{ flex: 1, backgroundColor: C.green, color: "#fff", fontSize: 14, fontWeight: "bold", padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer" }}
                >
                  Load
                </button>
                <button
                  onClick={() => setDeleteId(s.id)}
                  style={{ backgroundColor: "#fff", color: C.red, fontSize: 14, fontWeight: "bold", padding: "8px 12px", borderRadius: 8, border: `2px solid ${C.red}`, cursor: "pointer" }}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", backgroundColor: C.bg, color: C.black }}>

      {/* Settings Modal */}
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: 40, maxWidth: 480, width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}>
            <h2 style={{ fontSize: 26, fontWeight: "bold", marginTop: 0, marginBottom: 28 }}>⚙️ Your Profile</h2>
            <label style={labelBase}>Your Name</label>
            <input
              value={profileName}
              onChange={e => setProfileName(e.target.value)}
              placeholder="e.g. Jesse's Landscaping"
              style={{ ...inputBase, marginBottom: 20 }}
            />
            <label style={labelBase}>Default Markup %</label>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
              <input
                type="range" min={10} max={150} step={5} value={profileMrk}
                onChange={e => setProfileMrk(+e.target.value)}
                className="le-slider-green"
                style={{ flex: 1, height: 8, cursor: "pointer" }}
              />
              <span style={{ fontSize: 28, fontWeight: "bold", color: C.green, minWidth: 70, textAlign: "right" }}>
                {profileMrk}%
              </span>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={saveProfile} style={{ ...btnGreen, flex: 1 }}>Save Profile</button>
              <button
                onClick={() => setShowSettings(false)}
                style={{ fontSize: 18, padding: "12px 20px", borderRadius: 10, border: "2px solid #d1d5db", backgroundColor: "#fff", cursor: "pointer" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteId && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: 40, maxWidth: 400, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🗑️</div>
            <h3 style={{ fontSize: 22, fontWeight: "bold", marginBottom: 12 }}>Remove this estimate?</h3>
            <p style={{ fontSize: 17, color: "#555", marginBottom: 28 }}>This can&apos;t be undone.</p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                onClick={() => doDelete(deleteId)}
                style={{ backgroundColor: C.red, color: "#fff", fontSize: 18, fontWeight: "bold", padding: "12px 24px", borderRadius: 10, border: "none", cursor: "pointer" }}
              >
                Yes, Remove
              </button>
              <button
                onClick={() => setDeleteId(null)}
                style={{ fontSize: 18, padding: "12px 20px", borderRadius: 10, border: "2px solid #d1d5db", backgroundColor: "#fff", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Layout */}
      <div style={{ display: "flex", minHeight: "100vh" }}>

        {/* Desktop Sidebar */}
        <aside
          className="le-sidebar"
          style={{ width: 280, minWidth: 280, backgroundColor: "#fff", borderRight: `3px solid ${C.green}`, padding: "28px 16px", display: "flex", flexDirection: "column" }}
        >
          <SavedPanel />
        </aside>

        {/* Main */}
        <main style={{ flex: 1, minWidth: 0 }}>

          {/* Header */}
          <header style={{ backgroundColor: C.green, padding: "20px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: "bold", color: "#fff", margin: 0, lineHeight: 1.2 }}>
                🌿 LandscapeEstimate
              </h1>
              <p style={{ fontSize: 15, color: "rgba(255,255,255,0.75)", margin: "4px 0 0 0" }}>
                AI-powered materials estimator
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                className="le-past-btn"
                onClick={() => setShowSidebar(v => !v)}
                style={{ display: "none", backgroundColor: "rgba(255,255,255,0.2)", color: "#fff", fontSize: 15, fontWeight: "bold", padding: "10px 14px", borderRadius: 10, border: "none", cursor: "pointer" }}
              >
                📋 Past Jobs
              </button>
              <button
                onClick={() => setShowSettings(true)}
                title="Profile Settings"
                style={{ backgroundColor: "rgba(255,255,255,0.2)", color: "#fff", fontSize: 22, padding: "10px 14px", borderRadius: 10, border: "none", cursor: "pointer" }}
              >
                ⚙️
              </button>
            </div>
          </header>

          <div className="le-pad" style={{ padding: "28px 36px", maxWidth: 940, margin: "0 auto" }}>

            {/* Profile Banner */}
            {showBanner && (
              <div
                onClick={() => setShowSettings(true)}
                style={{ backgroundColor: "#FFF9E6", border: `2px solid ${C.amber}`, borderRadius: 12, padding: "14px 20px", marginBottom: 24, cursor: "pointer", fontSize: 17, fontWeight: "bold", color: C.black, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
              >
                <span>👋 Set up your profile to save your name and default markup!</span>
                <span style={{ fontSize: 13, fontWeight: "normal", color: "#777" }}>Click to open ⚙️</span>
              </div>
            )}

            {/* Mobile Sidebar Drawer */}
            {showSidebar && (
              <div style={{ backgroundColor: "#fff", border: `2px solid ${C.green}`, borderRadius: 12, padding: 20, marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <span style={{ fontSize: 18, fontWeight: "bold", color: C.green }}>📋 Past Jobs</span>
                  <button onClick={() => setShowSidebar(false)} style={{ fontSize: 22, border: "none", background: "none", cursor: "pointer", color: "#666" }}>✕</button>
                </div>
                <SavedPanel />
              </div>
            )}

            {/* Form */}
            <form
              onSubmit={handleSubmit}
              style={{ backgroundColor: "#fff", borderRadius: 16, border: `2px solid rgba(45,106,79,0.12)`, boxShadow: "0 4px 24px rgba(0,0,0,0.07)", padding: 32, marginBottom: 28 }}
            >
              <h2 style={{ fontSize: 26, fontWeight: "bold", color: C.green, marginTop: 0, marginBottom: 24 }}>
                Let&apos;s build your estimate! 🌱
              </h2>
              <div className="le-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
                <div>
                  <label style={labelBase}>Contractor Name</label>
                  <input
                    value={contractor}
                    onChange={e => setContractor(e.target.value)}
                    placeholder="Your name or company"
                    style={inputBase}
                  />
                </div>
                <div>
                  <label style={labelBase}>
                    Job Address <span style={{ color: C.red }}>*</span>
                  </label>
                  <input
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="123 Main St, City, State ZIP"
                    required
                    style={inputBase}
                  />
                </div>
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={labelBase}>
                  Job Description <span style={{ color: C.red }}>*</span>
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={5}
                  required
                  placeholder="Describe the job in detail — dimensions, materials, scope. E.g. '800 sq ft sod install, 40-foot mulch bed, 4 knockout roses...'"
                  style={{ ...inputBase, minHeight: 130, resize: "vertical" }}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                style={{ ...btnGreen, opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer" }}
              >
                {loading ? "Working on it..." : "🔍 Generate Estimate"}
              </button>
            </form>

            {/* Error */}
            {error && !loading && (
              <div style={{ backgroundColor: "#FFF0EE", border: `2px solid ${C.red}`, borderRadius: 12, padding: 28, marginBottom: 24 }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>⚠️</div>
                <div style={{ fontSize: 22, fontWeight: "bold", color: C.red, marginBottom: 8 }}>Something went wrong</div>
                <div style={{ fontSize: 18, color: "#555", marginBottom: 24 }}>
                  We couldn&apos;t reach the estimator. Check your internet connection and try again.
                </div>
                <button onClick={runEstimate} style={{ ...btnGreen, backgroundColor: C.red }}>Try Again</button>
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div style={{ backgroundColor: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.07)", padding: 48, textAlign: "center", marginBottom: 24 }}>
                <div
                  style={{ fontSize: 22, fontWeight: "bold", color: C.green, marginBottom: 8, transition: "opacity 0.3s ease", opacity: msgVisible ? 1 : 0 }}
                >
                  {LOADING_MSGS[msgIdx]}
                </div>
                <div style={{ fontSize: 15, color: "#999", marginBottom: 28 }}>
                  Searching stores near {address}
                </div>
                <div style={{ backgroundColor: "#e5e7eb", borderRadius: 99, height: 12, overflow: "hidden" }}>
                  <div
                    key={loading ? "active" : "idle"}
                    className="le-progress"
                    style={{ height: "100%", backgroundColor: C.green, borderRadius: 99 }}
                  />
                </div>
              </div>
            )}

            {/* Results */}
            {hasEstimate && (
              <>
                {/* Action Bar */}
                <div className="le-action-bar" style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                  {showNewConfirm ? (
                    <div style={{ width: "100%", backgroundColor: "#FFF9E6", border: `2px solid ${C.amber}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 17, fontWeight: "bold", flex: 1 }}>
                        Start over? Your current estimate isn&apos;t saved yet.
                      </span>
                      <button onClick={doReset} style={{ ...btnAmber, padding: "10px 18px", fontSize: 17 }}>
                        Yes, Start Over
                      </button>
                      <button
                        onClick={() => setShowNewConfirm(false)}
                        style={{ fontSize: 17, padding: "10px 16px", borderRadius: 10, border: "2px solid #d1d5db", backgroundColor: "#fff", cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button onClick={handleStartNew} style={btnAmber}>🔄 Start New Estimate</button>
                      <button onClick={saveEstimate} style={btnGreen}>💾 Save Estimate</button>
                      <button
                        onClick={copyToClipboard}
                        style={{ fontSize: 20, fontWeight: "bold", padding: "14px 24px", borderRadius: 10, border: `2px solid ${C.green}`, backgroundColor: "#fff", color: C.green, cursor: "pointer" }}
                      >
                        {copied ? "✓ Copied!" : "📋 Copy"}
                      </button>
                    </>
                  )}
                </div>

                {/* Estimate Table */}
                <div style={{ backgroundColor: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.07)", marginBottom: 28, overflow: "hidden", border: `2px solid rgba(45,106,79,0.12)` }}>
                  <div style={{ backgroundColor: C.green, padding: "18px 24px" }}>
                    <h2 style={{ fontSize: 26, fontWeight: "bold", color: "#fff", margin: 0 }}>
                      Your estimate is ready 🌿
                    </h2>
                  </div>

                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
                      <thead>
                        <tr style={{ backgroundColor: C.lgn, borderBottom: `2px solid ${C.green}` }}>
                          {["Material", "Qty", "Unit", "Low $", "High $", "Source", ""].map((h, i) => (
                            <th key={i} style={{ fontSize: 16, fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.04em", color: C.green, padding: "14px 10px", textAlign: "left", whiteSpace: "nowrap" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matItems.map((item, i) => {
                          const gi = items.indexOf(item);
                          return (
                            <tr key={i} style={{ borderBottom: "1px solid #f0f0f0", minHeight: 48 }}>
                              <EditCell value={item.material} onChange={v => updateItem(gi, "material", v)} wide />
                              <EditCell value={item.qty}      onChange={v => updateItem(gi, "qty",  parseFloat(v) || 0)} type="number" />
                              <EditCell value={item.unit}     onChange={v => updateItem(gi, "unit", v)} />
                              <EditCell value={item.low}      onChange={v => updateItem(gi, "low",  parseFloat(v) || 0)} type="number" prefix="$" />
                              <EditCell value={item.high}     onChange={v => updateItem(gi, "high", parseFloat(v) || 0)} type="number" prefix="$" />
                              <EditCell value={item.source}   onChange={v => updateItem(gi, "source", v)} wide />
                              <td style={{ padding: "4px 10px" }}>
                                <button
                                  onClick={() => removeRow(gi)}
                                  title="Remove"
                                  style={{ color: C.red, backgroundColor: "transparent", border: "none", fontSize: 18, cursor: "pointer", padding: "4px 8px" }}
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ padding: "8px 16px 12px" }}>
                    <button
                      onClick={addRow}
                      style={{ fontSize: 16, fontWeight: "bold", color: C.green, backgroundColor: "transparent", border: "none", cursor: "pointer" }}
                    >
                      + Add row
                    </button>
                  </div>

                  {/* Totals footer */}
                  <div style={{ borderTop: `3px solid ${C.green}`, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
                      <tbody>
                        <TotalRow label="Subtotal"             low={subLow}   high={subHigh}  />
                        <TotalRow label="Delivery (est.)"      low={delLow}   high={delHigh}  source={delItem?.source} />
                        <TotalRow label="Iowa Sales Tax (7%)"  low={taxLow}   high={taxHigh}  source="Iowa state sales tax" />
                        <TotalRow label="GRAND TOTAL"          low={grandLow} high={grandHigh} grand />
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Notes */}
                {estimate.notes && (
                  <div style={{ backgroundColor: C.lgn, border: `2px solid rgba(45,106,79,0.25)`, borderRadius: 12, padding: 20, marginBottom: 16, fontSize: 17 }}>
                    <span style={{ fontWeight: "bold" }}>Notes: </span>{estimate.notes}
                  </div>
                )}

                {/* Clarifications — interactive form */}
                {(estimate.clarifications_needed?.length ?? 0) > 0 && (
                  <div style={{ backgroundColor: "#fff", border: `2px solid ${C.amber}`, borderRadius: 16, padding: 28, marginBottom: 28, boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
                    <h3 style={{ fontSize: 22, fontWeight: "bold", color: C.black, marginTop: 0, marginBottom: 6 }}>
                      📝 A Few Quick Questions
                    </h3>
                    <p style={{ fontSize: 16, color: "#666", marginBottom: 24, marginTop: 0 }}>
                      Answers improve your estimate accuracy
                    </p>

                    {estimate.clarifications_needed.map((q, i) => (
                      <ClarificationInput
                        key={i}
                        question={q}
                        index={i}
                        value={clarAnswers[i] ?? ""}
                        onChange={v => setClarAnswers(prev => ({ ...prev, [i]: v }))}
                      />
                    ))}

                    {refineMsg && (
                      <div style={{
                        backgroundColor: refineMsg.startsWith("✅") || !refineMsg.startsWith("Refine") ? "#F0F7F4" : "#FFF0EE",
                        border: `2px solid ${refineMsg.startsWith("Refine") ? C.red : C.green}`,
                        borderRadius: 10, padding: "12px 18px", marginBottom: 16,
                        fontSize: 16, fontWeight: "bold",
                        color: refineMsg.startsWith("Refine") ? C.red : C.green,
                      }}>
                        {refineMsg.startsWith("Refine") ? "⚠️ " : "✅ "}{refineMsg}
                      </div>
                    )}

                    <button
                      onClick={refineEstimate}
                      disabled={refining || Object.keys(clarAnswers).length === 0}
                      style={{
                        backgroundColor: refining ? "#aaa" : C.green,
                        color: "#fff", fontSize: 20, fontWeight: "bold",
                        padding: "14px 32px", borderRadius: 10, border: "none",
                        cursor: refining || Object.keys(clarAnswers).length === 0 ? "not-allowed" : "pointer",
                        opacity: Object.keys(clarAnswers).length === 0 ? 0.5 : 1,
                      }}
                    >
                      {refining ? "Refining…" : "🔄 Refine Estimate"}
                    </button>
                  </div>
                )}

                {/* Markup Calculator */}
                <div style={{ backgroundColor: "#fff", borderRadius: 16, border: `2px solid rgba(244,162,49,0.25)`, boxShadow: "0 4px 24px rgba(0,0,0,0.07)", padding: 32, marginBottom: 28 }}>
                  <h2 style={{ fontSize: 26, fontWeight: "bold", marginTop: 0, marginBottom: 6 }}>
                    💰 Your Quote to the Customer
                  </h2>
                  <p style={{ fontSize: 17, color: "#666", marginBottom: 28 }}>
                    This covers your labor, equipment, truck, and profit. Adjust until it feels right.
                  </p>

                  <label style={{ ...labelBase, marginBottom: 14 }}>
                    How much do you want to mark up materials?
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 6 }}>
                    <input
                      type="range" min={10} max={150} step={5} value={markup}
                      onChange={e => setMarkup(+e.target.value)}
                      className="le-slider-amber"
                      style={{ flex: 1, height: 8, cursor: "pointer" }}
                    />
                    <span style={{ fontSize: 32, fontWeight: "bold", color: C.green, minWidth: 80, textAlign: "right" }}>
                      {markup}%
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#aaa", marginBottom: 28 }}>
                    <span>10%</span><span>150%</span>
                  </div>

                  <div className="le-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
                    <StatBox label="Materials Cost"       value={`$${fmt(midpoint)}`}  variant="neutral" />
                    <StatBox label="Your Markup"          value={`$${fmt(mrkAmt)}`}    variant="highlight" />
                    <StatBox label="Charge the Customer"  value={`$${fmt(custQuote)}`} variant="primary" />
                  </div>
                </div>

                {/* PDF Button */}
                <button
                  onClick={downloadPDF}
                  style={{ ...btnGreen, width: "100%", justifyContent: "center", display: "flex", marginBottom: 48 }}
                >
                  📄 Download PDF Estimate
                </button>
              </>
            )}
          </div>
        </main>
      </div>

      <style>{`
        @keyframes le-prog {
          0%  { width: 4%; }
          30% { width: 55%; }
          60% { width: 78%; }
          85% { width: 91%; }
          100%{ width: 97%; }
        }
        .le-progress { animation: le-prog 28s ease-out forwards; }

        input[type=range] {
          -webkit-appearance: none; appearance: none;
          background: #e5e7eb; border-radius: 4px;
        }
        .le-slider-amber::-webkit-slider-thumb {
          -webkit-appearance: none; width: 26px; height: 26px;
          border-radius: 50%; background: ${C.amber}; cursor: pointer;
          border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }
        .le-slider-green::-webkit-slider-thumb {
          -webkit-appearance: none; width: 26px; height: 26px;
          border-radius: 50%; background: ${C.green}; cursor: pointer;
          border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }
        input:focus { outline: 3px solid ${C.green} !important; outline-offset: 2px; }
        textarea:focus { outline: 3px solid ${C.green} !important; outline-offset: 2px; }

        @media (max-width: 767px) {
          .le-sidebar    { display: none !important; }
          .le-past-btn   { display: inline-flex !important; }
          .le-form-grid  { grid-template-columns: 1fr !important; }
          .le-stat-grid  { grid-template-columns: 1fr !important; }
          .le-pad        { padding: 16px !important; }
          .le-action-bar > button { width: 100%; justify-content: center; }
        }
        @media (min-width: 768px) {
          .le-past-btn { display: none !important; }
        }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
