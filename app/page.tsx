"use client";

/**
 * The estimate screen.
 *
 * Address + a sentence about the job is enough; everything else is optional.
 * The map, when opened, lets the estimator measure beds and drain runs on the
 * aerial photo. After generating, every edit autosaves: the haul re-plans on
 * the server (change 20 tons to 30 and the loads follow) and the edit is
 * logged as a correction for the field test.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { C } from "./theme";
import { ClarificationInput } from "./components/estimate/Clarifications";
import EstimateTable from "./components/estimate/EstimateTable";
import HaulPanel from "./components/estimate/HaulPanel";
import MachinePanel, { type EquipmentOption } from "./components/estimate/MachinePanel";
import { downloadEstimatePdf } from "./components/estimate/pdf";
import { bottomFrom, computeTotals, fmt, isMaterialRow, type Bottom } from "./components/estimate/totals";
import type { EstimateData, LineItem, MapMeasurement, SettingsData, SiteSummary } from "./components/estimate/types";
import type { EstimateListItem } from "@/lib/estimates/service";

const SiteMap = dynamic(() => import("./components/SiteMap"), {
  ssr: false,
  loading: () => <div style={{ padding: 24, color: C.grey }}>Loading the map…</div>,
});

const LOADING_MSGS = [
  "📍 Looking up the property…",
  "🛰️ Checking the aerial photo and the lay of the land…",
  "🪨 Picking materials and working out quantities…",
  "🚚 Comparing suppliers by delivered cost…",
  "⛽ Planning loads with this week's diesel price…",
  "🧮 Putting your estimate together…",
];

const EMPTY_BOTTOM: Bottom = { haul: 0, haulLabel: "", haulComputed: false, machine: 0, machineLabel: "", deposit: 0, depositLabel: "" };

function TotalRow({ label, low, high, note, grand }: { label: string; low: number; high: number; note?: string; grand?: boolean }) {
  const col = grand ? "#fff" : C.black;
  const same = Math.abs(high - low) < 0.005;
  return (
    <tr style={{ background: grand ? C.green : C.bg, borderBottom: grand ? "none" : "1px solid #e5e7eb" }}>
      <td style={{ padding: "12px 16px", fontSize: grand ? 22 : 17, fontWeight: 700, color: col }}>
        {label}
        {note && <div style={{ fontSize: 13, fontWeight: 400, color: grand ? "rgba(255,255,255,0.7)" : C.grey, marginTop: 2 }}>{note}</div>}
      </td>
      <td style={{ padding: "12px 16px", fontSize: grand ? 22 : 17, fontWeight: 700, color: col, textAlign: "right", verticalAlign: "top" }}>
        <span style={{ whiteSpace: "nowrap" }}>${fmt(low)}</span>
        {!same && (
          <>
            {" – "}
            <span style={{ whiteSpace: "nowrap" }}>${fmt(high)}</span>
          </>
        )}
      </td>
    </tr>
  );
}

function StatBox({ label, value, variant = "neutral" }: { label: string; value: string; variant?: "neutral" | "highlight" | "primary" }) {
  const bg = variant === "primary" ? C.green : variant === "highlight" ? "#FFF9E6" : C.bg;
  const border = variant === "primary" ? "none" : variant === "highlight" ? `2px solid ${C.amber}` : "2px solid #e5e7eb";
  return (
    <div style={{ background: bg, border, borderRadius: 12, padding: "20px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: variant === "primary" ? "rgba(255,255,255,0.8)" : "#666", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: variant === "primary" ? 26 : 22, fontWeight: 700, color: variant === "primary" ? "#fff" : C.black }}>{value}</div>
    </div>
  );
}

function PastJobs({ jobs, onLoad, currentId }: { jobs: EstimateListItem[]; onLoad: (id: string) => void; currentId: string | null }) {
  return (
    <>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: C.green, marginTop: 0, marginBottom: 16 }}>📋 Past Jobs</h2>
      {jobs.length === 0 ? (
        <p style={{ fontSize: 16, color: "#777", lineHeight: 1.7, textAlign: "center", marginTop: 20 }}>
          No estimates yet.
          <br />
          Every estimate you make
          <br />
          is saved here automatically.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}>
          {jobs.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => onLoad(j.id)}
              style={{
                textAlign: "left",
                border: `2px solid ${j.id === currentId ? C.green : "#e5e7eb"}`,
                borderRadius: 10,
                padding: 12,
                background: j.id === currentId ? C.lgn : C.bg,
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700, color: C.black }}>{j.jobAddress}</div>
              <div style={{ fontSize: 13, color: "#666", margin: "2px 0 6px" }}>
                {new Date(j.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                {j.edited ? " · edited" : ""}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>
                ${fmt(j.appLow)}
                {Math.abs(j.appHigh - j.appLow) > 0.005 ? ` – $${fmt(j.appHigh)}` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default function Home() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [jobs, setJobs] = useState<EstimateListItem[]>([]);
  const [showJobs, setShowJobs] = useState(false);

  // Form
  const [contractor, setContractor] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [measurements, setMeasurements] = useState<MapMeasurement[]>([]);
  const [showMap, setShowMap] = useState(false);
  const startedAt = useRef<number | null>(null);

  // Estimate
  const [est, setEst] = useState<EstimateData | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [bottom, setBottom] = useState<Bottom>(EMPTY_BOTTOM);
  const [markup, setMarkup] = useState(35);
  const [trucks, setTrucks] = useState(1);
  const [loading, setLoading] = useState(false);
  const [msgIdx, setMsgIdx] = useState(0);
  const [error, setError] = useState("");
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [clarAnswers, setClarAnswers] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState(false);
  const [handTotal, setHandTotal] = useState("");
  const [handMinutes, setHandMinutes] = useState("");
  /** True when this estimate was generated in this session (so its app time is real). */
  const timedRef = useRef(false);

  const itemsRef = useRef(items);
  const markupRef = useRef(markup);
  const estRef = useRef(est);
  useEffect(() => {
    itemsRef.current = items;
    markupRef.current = markup;
    estRef.current = est;
  }, [items, markup, est]);

  // ── bootstrap ──
  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/estimates");
      if (res.ok) setJobs((await res.json()).estimates);
    } catch {
      // the list is a convenience
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [res, eq] = await Promise.all([fetch("/api/settings"), fetch("/api/equipment")]);
        if (res.ok && alive) {
          const { settings: s } = (await res.json()) as { settings: SettingsData };
          setSettings(s);
          setContractor((c) => c || s.companyName || s.displayName);
          setMarkup(s.defaultMarkupPct || 35);
          setTrucks(s.trucksPerJob || 1);
        }
        if (eq.ok && alive) setEquipment((await eq.json()).equipment ?? []);
      } catch {
        // defaults are fine
      }
      if (alive) await loadJobs();
    })();
    return () => {
      alive = false;
    };
  }, [loadJobs]);

  // Opened from the field-test page: /?id=<estimate>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) return;
    (async () => {
      await loadJob(id);
    })();
    // Run once on arrival; loadJob is a plain function recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── rotating status line while generating ──
  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setMsgIdx((i) => (i + 1) % LOADING_MSGS.length), 3500);
    return () => clearInterval(t);
  }, [loading]);

  // ── autosave ──
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveNow = useCallback(async (extra: Record<string, unknown> = {}) => {
    const cur = estRef.current;
    if (!cur?.id) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSave("saving");
    try {
      const body: Record<string, unknown> = {
        lines: itemsRef.current.map((i) => ({ ...i, kind: "material" })),
        markupPct: markupRef.current,
        ...extra,
      };
      if (timedRef.current && startedAt.current) {
        body.appSeconds = Math.round((Date.now() - startedAt.current) / 1000);
      }
      const res = await fetch(`/api/estimates/${cur.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const view = (await res.json()) as EstimateData;
      setBottom(bottomFrom(view.line_items));
      setEst((e) => (e ? { ...e, haul: view.haul, warnings: view.warnings, trucksForJob: view.trucksForJob } : e));
      // Refresh only server-derived per-line fields; never clobber what's being typed.
      const serverRows = view.line_items.filter(isMaterialRow);
      setItems((prev) =>
        prev.length === serverRows.length
          ? prev.map((p, i) =>
              serverRows[i].material === p.material ? { ...p, haul: serverRows[i].haul, miles: serverRows[i].miles, milesApprox: serverRows[i].milesApprox } : p
            )
          : prev
      );
      setSave("saved");
      loadJobs();
    } catch {
      setSave("error");
    }
  }, [loadJobs]);

  const queueSave = useCallback(() => {
    if (!estRef.current?.id) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSave("idle");
    saveTimer.current = setTimeout(() => saveNow(), 1200);
  }, [saveNow]);

  // ── actions ──
  function adopt(data: EstimateData) {
    setEst(data);
    setItems(data.line_items.filter(isMaterialRow));
    setBottom(bottomFrom(data.line_items));
    setTrucks(data.trucksForJob || 1);
    setClarAnswers({});
    setSave("idle");
  }

  async function generate(extra: { answers?: string; previousEstimateId?: string } = {}) {
    if (!address.trim() || !description.trim()) return;
    setLoading(true);
    setMsgIdx(0);
    setError("");
    try {
      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractorName: contractor,
          jobAddress: address,
          jobDescription: description,
          measurements,
          trucksForJob: trucks,
          ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      timedRef.current = true;
      if (!startedAt.current) startedAt.current = Date.now();
      adopt(data as EstimateData);
      setHandTotal("");
      setHandMinutes("");
      loadJobs();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function loadJob(id: string) {
    setShowJobs(false);
    try {
      const res = await fetch(`/api/estimates/${id}`);
      if (!res.ok) return;
      const view = (await res.json()) as EstimateData;
      timedRef.current = false;
      startedAt.current = null;
      adopt(view);
      setAddress(view.jobAddress ?? "");
      setDescription((view.jobDescription ?? "").replace(/\n\nAnswers:[\s\S]*$/, ""));
      setContractor(view.contractorName || contractor);
      setMarkup(view.markupPct || markup);
      const site = view.site as SiteSummary | null;
      setMeasurements(site?.measurements ?? []);
      setHandTotal(view.fieldTest?.handTotal != null ? String(view.fieldTest.handTotal) : "");
      setHandMinutes(view.fieldTest?.handMinutes != null ? String(view.fieldTest.handMinutes) : "");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      // ignore
    }
  }

  function startNew() {
    setEst(null);
    setItems([]);
    setBottom(EMPTY_BOTTOM);
    setDescription("");
    setAddress("");
    setMeasurements([]);
    setShowMap(false);
    setError("");
    startedAt.current = null;
    timedRef.current = false;
  }

  function onItems(next: LineItem[]) {
    setItems(next);
    queueSave();
  }

  function onTrucks(n: number) {
    setTrucks(n);
    if (est?.id) saveNow({ trucksForJob: n });
  }

  function onMachines(uses: { equipmentId: string; hours: number; basis?: string }[]) {
    if (est?.id) saveNow({ machines: uses });
  }

  function refine() {
    if (!est) return;
    const answered = (est.clarifications_needed ?? [])
      .map((q, i) => (clarAnswers[i] ? `Q: ${q}\nA: ${clarAnswers[i]}` : null))
      .filter(Boolean)
      .join("\n\n");
    if (!answered) return;
    generate({ answers: answered, previousEstimateId: est.id ?? undefined });
  }

  // ── derived ──
  const tax = est?.tax ?? { ratePct: settings?.taxRatePct ?? 7, haul: true, deposits: false };
  const t = computeTotals(items, bottom, tax);
  const midpoint = (t.grandLow + t.grandHigh) / 2;
  const mrkAmt = midpoint * (markup / 100);
  const taxLabel = `Sales tax (${tax.ratePct}%)`;
  const taxNote = `On materials${tax.haul ? (t.machine > 0 ? " + hauling + machine fuel" : " + hauling") : ""}${tax.deposits ? " + deposits" : ""}`;
  const site = (est?.site ?? null) as SiteSummary | null;
  const gateWarnings = ((est?.verification as { warnings?: { gate: string; detail: string }[] } | undefined)?.warnings ?? []).filter(
    (w) => w.gate !== "catalog_coverage"
  );

  async function copy() {
    const rows = [
      `LandscapeEstimate — ${contractor || "Contractor"}`,
      `Job: ${address}`,
      "",
      ["Material", "Qty", "Unit", "Low $", "High $", "From"].join("\t"),
      ...items.map((i) => [i.material, i.qty, i.unit, `$${fmt(i.low)}`, `$${fmt(i.high)}`, i.source].join("\t")),
      "",
      `Subtotal\t\t\t$${fmt(t.subLow)}\t$${fmt(t.subHigh)}`,
      `Hauling\t\t\t$${fmt(t.haul)}\t$${fmt(t.haul)}`,
      ...(t.machine ? [`Machine fuel\t\t\t$${fmt(t.machine)}\t$${fmt(t.machine)}`] : []),
      ...(t.deposit ? [`Pallet deposits\t\t\t$${fmt(t.deposit)}\t$${fmt(t.deposit)}`] : []),
      `${taxLabel}\t\t\t$${fmt(t.taxLow)}\t$${fmt(t.taxHigh)}`,
      `GRAND TOTAL\t\t\t$${fmt(t.grandLow)}\t$${fmt(t.grandHigh)}`,
    ];
    await navigator.clipboard.writeText(rows.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── styles ──
  const inputBase: React.CSSProperties = {
    fontSize: 18,
    color: C.black,
    background: "#fff",
    border: "2px solid #d1d5db",
    borderRadius: 8,
    padding: "14px 16px",
    width: "100%",
    minHeight: 52,
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };
  const labelBase: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: C.black, display: "block", marginBottom: 8 };
  const btnGreen: React.CSSProperties = { background: C.green, color: "#fff", fontSize: 20, fontWeight: 700, padding: "14px 28px", borderRadius: 10, border: "none", cursor: "pointer" };
  const btnAmber: React.CSSProperties = { background: C.amber, color: C.black, fontSize: 20, fontWeight: 700, padding: "14px 28px", borderRadius: 10, border: "none", cursor: "pointer" };
  const card: React.CSSProperties = { background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.07)", border: `2px solid rgba(45,106,79,0.12)`, marginBottom: 24 };

  const hasEstimate = Boolean(est);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.black, display: "flex" }}>
      <aside className="le-sidebar" style={{ width: 280, minWidth: 280, background: "#fff", borderRight: `3px solid ${C.green}`, padding: "28px 16px", display: "flex", flexDirection: "column" }}>
        <PastJobs jobs={jobs} onLoad={loadJob} currentId={est?.id ?? null} />
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>
        <div className="le-pad" style={{ padding: "28px 36px", maxWidth: 980, margin: "0 auto" }}>
          <button className="le-past-btn" type="button" onClick={() => setShowJobs((v) => !v)} style={{ display: "none", ...btnGreen, fontSize: 16, padding: "10px 16px", marginBottom: 16 }}>
            📋 Past jobs
          </button>
          {showJobs && (
            <div style={{ ...card, padding: 20 }}>
              <PastJobs jobs={jobs} onLoad={loadJob} currentId={est?.id ?? null} />
            </div>
          )}

          {settings && !settings.shopLocated && (
            <Link
              href="/settings"
              style={{ display: "block", background: "#FFF9E6", border: `2px solid ${C.amber}`, borderRadius: 12, padding: "14px 20px", marginBottom: 24, fontSize: 17, fontWeight: 700, color: C.black, textDecoration: "none" }}
            >
              👋 Set your shop address and trucks in Settings so hauling is figured from real distances and diesel. →
            </Link>
          )}

          {/* ── form ── */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              generate();
            }}
            style={{ ...card, padding: 32 }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <h2 style={{ fontSize: 26, fontWeight: 700, color: C.green, margin: 0 }}>{hasEstimate ? "Job" : "New estimate 🌱"}</h2>
              {hasEstimate && (
                <button type="button" onClick={startNew} style={{ ...btnAmber, fontSize: 16, padding: "10px 16px" }}>
                  🔄 Start a new one
                </button>
              )}
            </div>

            <div className="le-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 20, marginBottom: 20 }}>
              <div>
                <label style={labelBase} htmlFor="le-contractor">Contractor</label>
                <input id="le-contractor" value={contractor} onChange={(e) => setContractor(e.target.value)} placeholder="Your name or company" style={inputBase} />
              </div>
              <div>
                <label style={labelBase} htmlFor="le-address">
                  Job address <span style={{ color: C.red }}>*</span>
                </label>
                <input
                  id="le-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="2809 Muscatine Ave, Iowa City"
                  required
                  autoComplete="street-address"
                  style={inputBase}
                />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={labelBase} htmlFor="le-desc">
                What&apos;s the job? <span style={{ color: C.red }}>*</span>
              </label>
              <textarea
                id="le-desc"
                value={description}
                onChange={(e) => {
                  if (!startedAt.current) startedAt.current = Date.now();
                  setDescription(e.target.value);
                }}
                rows={4}
                required
                placeholder="A couple of words is fine — 'drainage project', 'new sod out front' — or as much detail as you like."
                style={{ ...inputBase, minHeight: 110, resize: "vertical" }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <button
                type="button"
                onClick={() => setShowMap((v) => !v)}
                disabled={address.trim().length < 5}
                style={{ background: "#fff", color: C.green, border: `2px solid ${C.green}`, fontSize: 18, fontWeight: 700, padding: "12px 20px", borderRadius: 10, cursor: address.trim().length < 5 ? "not-allowed" : "pointer", opacity: address.trim().length < 5 ? 0.5 : 1 }}
              >
                📍 {showMap ? "Hide the map" : "Measure on the map"}
                {measurements.length > 0 && ` (${measurements.length} measured)`}
              </button>
              {!showMap && <span style={{ marginLeft: 12, fontSize: 14, color: C.grey }}>Optional — outline beds or drain runs on the aerial photo for exact numbers.</span>}
              {showMap && (
                <div style={{ marginTop: 16 }}>
                  <SiteMap address={address} measurements={measurements} onChange={setMeasurements} />
                </div>
              )}
            </div>

            <button type="submit" disabled={loading} style={{ ...btnGreen, opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "Working on it…" : hasEstimate ? "🔍 Re-run estimate" : "🔍 Generate estimate"}
            </button>
          </form>

          {error && !loading && (
            <div style={{ background: "#FFF0EE", border: `2px solid ${C.red}`, borderRadius: 12, padding: 24, marginBottom: 24 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.red, marginBottom: 8 }}>⚠️ {error}</div>
              <button type="button" onClick={() => generate()} style={{ ...btnGreen, background: C.red }}>
                Try again
              </button>
            </div>
          )}

          {loading && (
            <div style={{ ...card, padding: 48, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.green, marginBottom: 8 }}>{LOADING_MSGS[msgIdx]}</div>
              <div style={{ fontSize: 15, color: "#999", marginBottom: 28 }}>{address}</div>
              <div style={{ background: "#e5e7eb", borderRadius: 99, height: 12, overflow: "hidden" }}>
                <div className="le-progress" style={{ height: "100%", background: C.green, borderRadius: 99 }} />
              </div>
            </div>
          )}

          {/* ── results ── */}
          {hasEstimate && est && !loading && (
            <>
              {site?.parcel && (
                <div style={{ ...card, padding: "16px 20px", fontSize: 15, display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "center" }}>
                  <b>🏡 {site.parcel.address || address}</b>
                  <span>Lot {Math.round(site.parcel.areaSqFt).toLocaleString()} sq ft</span>
                  {site.grade && (
                    <span>
                      Ground falls {site.grade.reliefFt} ft toward the {site.grade.drainsToward}
                    </span>
                  )}
                  {site.measurements?.length ? <span>{site.measurements.length} measured on the map</span> : null}
                  {site.parcel.link && (
                    <a href={site.parcel.link} target="_blank" rel="noreferrer" style={{ color: C.green, fontWeight: 700 }}>
                      Assessor record ↗
                    </a>
                  )}
                </div>
              )}

              <div style={card}>
                <div style={{ background: C.green, padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", borderRadius: "14px 14px 0 0" }}>
                  <h2 style={{ fontSize: 24, fontWeight: 700, color: "#fff", margin: 0 }}>Your estimate 🌿</h2>
                  <span style={{ fontSize: 14, color: "rgba(255,255,255,0.85)" }}>
                    {save === "saving" && "Saving…"}
                    {save === "saved" && "✓ Saved"}
                    {save === "error" && "⚠ Not saved — check your connection"}
                    {save === "idle" && (est.id ? "Changes save automatically" : "")}
                  </span>
                </div>

                <EstimateTable items={items} onChange={onItems} />

                <div style={{ borderTop: `3px solid ${C.green}`, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      <TotalRow label="Materials" low={t.subLow} high={t.subHigh} />
                      <TotalRow label="Hauling & delivery" low={t.haul} high={t.haul} note={bottom.haulLabel} />
                      {t.machine > 0 && <TotalRow label="Machine fuel" low={t.machine} high={t.machine} note={bottom.machineLabel} />}
                      {t.deposit > 0 && <TotalRow label="Pallet deposits (refundable)" low={t.deposit} high={t.deposit} note={bottom.depositLabel} />}
                      <TotalRow label={taxLabel} low={t.taxLow} high={t.taxHigh} note={taxNote} />
                      <TotalRow label="GRAND TOTAL" low={t.grandLow} high={t.grandHigh} grand />
                    </tbody>
                  </table>
                </div>
              </div>

              <HaulPanel haul={est.haul} total={t.haul} computed={bottom.haulComputed} trucksForJob={trucks} onTrucks={onTrucks} busy={save === "saving"} />

              {(equipment.length > 0 || (est.haul?.machines?.length ?? 0) > 0) && (
                <MachinePanel
                  lines={est.haul?.machines ?? []}
                  equipment={equipment}
                  total={t.machine}
                  fuel={est.haul?.fuel ?? null}
                  onChange={onMachines}
                  busy={save === "saving"}
                  canSave={Boolean(est.id)}
                />
              )}

              {(est.warnings?.length > 0 || gateWarnings.length > 0) && (
                <div style={{ background: "#FFF9E6", border: `2px solid ${C.amber}`, borderRadius: 12, padding: "14px 20px", marginBottom: 24, fontSize: 15 }}>
                  <b>Worth a look:</b>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                    {[...est.warnings.filter((w) => !est.haul?.warnings?.includes(w)), ...gateWarnings.map((g) => g.detail)].map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {est.notes && (
                <div style={{ background: C.lgn, border: `2px solid rgba(45,106,79,0.25)`, borderRadius: 12, padding: 20, marginBottom: 24, fontSize: 17 }}>
                  <b>Notes: </b>
                  {est.notes}
                </div>
              )}

              {est.clarifications_needed?.length > 0 && (
                <div style={{ ...card, padding: 28, border: `2px solid ${C.amber}` }}>
                  <h3 style={{ fontSize: 22, fontWeight: 700, marginTop: 0, marginBottom: 6 }}>📝 A few quick questions</h3>
                  <p style={{ fontSize: 16, color: "#666", marginTop: 0, marginBottom: 24 }}>Answer what you know, then update — the estimate is redone with your answers.</p>
                  {est.clarifications_needed.map((q, i) => (
                    <ClarificationInput key={i} question={q} index={i} value={clarAnswers[i] ?? ""} onChange={(v) => setClarAnswers((p) => ({ ...p, [i]: v }))} />
                  ))}
                  <button
                    type="button"
                    onClick={refine}
                    disabled={loading || Object.keys(clarAnswers).length === 0}
                    style={{ ...btnGreen, opacity: Object.keys(clarAnswers).length === 0 ? 0.5 : 1, cursor: Object.keys(clarAnswers).length === 0 ? "not-allowed" : "pointer" }}
                  >
                    🔄 Update estimate
                  </button>
                </div>
              )}

              <div style={{ ...card, padding: 32, border: `2px solid rgba(244,162,49,0.25)` }}>
                <h2 style={{ fontSize: 26, fontWeight: 700, marginTop: 0, marginBottom: 6 }}>💰 Your quote to the customer</h2>
                <p style={{ fontSize: 17, color: "#666", marginBottom: 28 }}>Covers your labor, equipment and profit on top of materials, hauling and tax.</p>
                <label style={{ ...labelBase, marginBottom: 14 }} htmlFor="le-markup">
                  Markup
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 28 }}>
                  <input
                    id="le-markup"
                    type="range"
                    min={10}
                    max={150}
                    step={5}
                    value={markup}
                    onChange={(e) => {
                      setMarkup(+e.target.value);
                      queueSave();
                    }}
                    className="le-slider-amber"
                    style={{ flex: 1, height: 8, cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 32, fontWeight: 700, color: C.green, minWidth: 80, textAlign: "right" }}>{markup}%</span>
                </div>
                <div className="le-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
                  <StatBox label="Your cost" value={`$${fmt(midpoint)}`} />
                  <StatBox label="Your markup" value={`$${fmt(mrkAmt)}`} variant="highlight" />
                  <StatBox label="Charge the customer" value={`$${fmt(midpoint + mrkAmt)}`} variant="primary" />
                </div>
              </div>

              {est.id && (
                <div style={{ ...card, padding: 24 }}>
                  <h3 style={{ fontSize: 20, fontWeight: 700, marginTop: 0, marginBottom: 6 }}>🧪 Field test</h3>
                  <p style={{ fontSize: 15, color: "#666", marginTop: 0 }}>
                    If you also did this one by hand, jot it down — the <Link href="/field-test" style={{ color: C.green, fontWeight: 700 }}>field test page</Link> compares them.
                  </p>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label style={{ fontSize: 16, fontWeight: 700 }}>
                      Hand total ($)
                      <input
                        inputMode="decimal"
                        value={handTotal}
                        onChange={(e) => setHandTotal(e.target.value)}
                        onBlur={() => saveNow({ handTotal: handTotal ? parseFloat(handTotal) || null : null })}
                        style={{ ...inputBase, width: 160, display: "block", marginTop: 6 }}
                      />
                    </label>
                    <label style={{ fontSize: 16, fontWeight: 700 }}>
                      Minutes by hand
                      <input
                        inputMode="numeric"
                        value={handMinutes}
                        onChange={(e) => setHandMinutes(e.target.value)}
                        onBlur={() => saveNow({ handMinutes: handMinutes ? parseInt(handMinutes, 10) || null : null })}
                        style={{ ...inputBase, width: 140, display: "block", marginTop: 6 }}
                      />
                    </label>
                  </div>
                </div>
              )}

              <div className="le-action-bar" style={{ display: "flex", gap: 12, marginBottom: 48, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() =>
                    downloadEstimatePdf({
                      contractor,
                      address,
                      items,
                      totals: t,
                      haulLabel: bottom.haulLabel,
                      machineLabel: bottom.machineLabel,
                      depositLabel: bottom.depositLabel,
                      taxLabel,
                      markupPct: markup,
                      clarifications: est.clarifications_needed ?? [],
                      notes: est.notes,
                    })
                  }
                  style={{ ...btnGreen, flex: 1 }}
                >
                  📄 Download PDF
                </button>
                <button type="button" onClick={copy} style={{ fontSize: 20, fontWeight: 700, padding: "14px 24px", borderRadius: 10, border: `2px solid ${C.green}`, background: "#fff", color: C.green, cursor: "pointer" }}>
                  {copied ? "✓ Copied!" : "📋 Copy"}
                </button>
              </div>
            </>
          )}
        </div>
      </main>

      <style>{`
        @keyframes le-prog { 0% { width: 4%; } 30% { width: 45%; } 60% { width: 70%; } 85% { width: 88%; } 100% { width: 96%; } }
        .le-progress { animation: le-prog 60s ease-out forwards; }
        input[type=range] { -webkit-appearance: none; appearance: none; background: #e5e7eb; border-radius: 4px; }
        .le-slider-amber::-webkit-slider-thumb {
          -webkit-appearance: none; width: 26px; height: 26px; border-radius: 50%;
          background: ${C.amber}; cursor: pointer; border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }
        input:focus, textarea:focus { outline: 3px solid ${C.green} !important; outline-offset: 2px; }
        @media (max-width: 767px) {
          .le-sidebar { display: none !important; }
          .le-past-btn { display: inline-flex !important; }
          .le-form-grid { grid-template-columns: 1fr !important; }
          .le-stat-grid { grid-template-columns: 1fr !important; }
          .le-pad { padding: 16px !important; }
          .le-action-bar > button { width: 100%; justify-content: center; }
        }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
