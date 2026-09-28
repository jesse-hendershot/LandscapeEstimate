"use client";

/**
 * The property map: aerial photo, lot lines, and a way to measure.
 *
 * Tap corners to outline a bed; tap along a run to draw a drain line. Areas
 * and lengths are computed as you go, and a drawn line gets its ground profile
 * from USGS lidar — how much it falls and whether there's a hump to dig
 * through. Everything drawn goes to the estimate as exact measurements.
 *
 * Built for thumbs: big buttons, no hidden gestures. Points snap to the lot
 * corners when you tap near one, so tracing a property line is easy.
 */

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useRef, useState } from "react";

import { lineLengthFt, polygonAreaSqFt, polygonPerimeterFt, type LatLng } from "@/lib/geo/geo";
import { tileMercBox } from "@/lib/site/mercator";
import { C } from "../theme";

export interface LineProfileInfo {
  lengthFt: number;
  startFt: number | null;
  endFt: number | null;
  fallFt: number | null;
  slopePct: number | null;
  worstRiseFt: number;
}

export interface MapMeasurement {
  id: string;
  label: string;
  kind: "area" | "line";
  points: LatLng[];
  sqft?: number;
  ft?: number;
  profile?: LineProfileInfo | null;
}

export interface SiteInfo {
  job: LatLng | null;
  matchedAddress: string | null;
  parcel: {
    county: string;
    id: string;
    address: string;
    city: string;
    areaSqFt: number;
    perimeterFt: number;
    edgesFt: number[];
    link: string;
    ring: LatLng[];
  } | null;
  grade: { highFt: number; lowFt: number; reliefFt: number; drainsToward: string } | null;
  aerialService: string;
}

const USGS_TILES =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";

/** An ArcGIS MapServer rendered as slippy tiles through its /export endpoint. */
function exportTileLayer(service: string, attribution: string): L.TileLayer {
  const Layer = L.TileLayer.extend({
    getTileUrl(coords: L.Coords) {
      const b = tileMercBox(coords.x, coords.y, coords.z);
      return (
        `${service}/export?bbox=${b.xmin},${b.ymin},${b.xmax},${b.ymax}` +
        `&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&transparent=false&f=image`
      );
    },
  }) as unknown as new (url: string, opts: L.TileLayerOptions) => L.TileLayer;
  return new Layer("", { minZoom: 15, maxZoom: 22, maxNativeZoom: 21, tileSize: 256, attribution });
}

const fmt0 = (n: number) => Math.round(n).toLocaleString("en-US");
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");

function describe(m: MapMeasurement): string {
  if (m.kind === "area") return `${fmt0(m.sqft ?? 0)} sq ft`;
  const p = m.profile;
  const base = `${fmt0(m.ft ?? 0)} ft`;
  if (!p || p.fallFt === null || p.slopePct === null) return base;
  const dir = p.fallFt >= 0 ? "falls" : "rises";
  return `${base} · ${dir} ${fmt1(Math.abs(p.fallFt))} ft (${fmt1(Math.abs(p.slopePct))}%)`;
}

export default function SiteMap({
  address,
  measurements,
  onChange,
  onSite,
}: {
  address: string;
  measurements: MapMeasurement[];
  onChange: (ms: MapMeasurement[]) => void;
  onSite?: (site: SiteInfo | null) => void;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const parcelLayer = useRef<L.LayerGroup | null>(null);
  const drawnLayer = useRef<L.LayerGroup | null>(null);
  const draftLayer = useRef<L.LayerGroup | null>(null);
  const countyLayer = useRef<L.TileLayer | null>(null);

  const [site, setSite] = useState<SiteInfo | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"none" | "area" | "line">("none");
  const [draft, setDraft] = useState<LatLng[]>([]);

  // Refs mirror state for the Leaflet click handler, which is bound once.
  const modeRef = useRef(mode);
  const draftRef = useRef(draft);
  const siteRef = useRef(site);
  useEffect(() => {
    modeRef.current = mode;
    draftRef.current = draft;
    siteRef.current = site;
  }, [mode, draft, site]);

  // ── map setup ──
  useEffect(() => {
    if (!holder.current || map.current) return;
    const m = L.map(holder.current, {
      center: [41.66, -91.53],
      zoom: 13,
      maxZoom: 22,
      zoomControl: true,
      doubleClickZoom: false,
      attributionControl: true,
    });
    L.tileLayer(USGS_TILES, { maxNativeZoom: 16, maxZoom: 22, attribution: "USGS The National Map" }).addTo(m);
    parcelLayer.current = L.layerGroup().addTo(m);
    drawnLayer.current = L.layerGroup().addTo(m);
    draftLayer.current = L.layerGroup().addTo(m);

    m.on("click", (e: L.LeafletMouseEvent) => {
      if (modeRef.current === "none") return;
      let p: LatLng = { lat: e.latlng.lat, lng: e.latlng.lng };
      // Snap to a lot corner within ~14 px.
      const ring = siteRef.current?.parcel?.ring ?? [];
      const clickPx = m.latLngToContainerPoint(e.latlng);
      for (const v of ring) {
        const vp = m.latLngToContainerPoint([v.lat, v.lng]);
        if (vp.distanceTo(clickPx) < 14) {
          p = v;
          break;
        }
      }
      setDraft((d) => [...d, p]);
    });

    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // ── load the site whenever the address settles ──
  useEffect(() => {
    const a = address.trim();
    if (a.length < 5) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setStatus("loading");
      setError("");
      try {
        const res = await fetch(`/api/site?address=${encodeURIComponent(a)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          setError(data.error || "Couldn't find that address.");
          setSite(null);
          onSite?.(null);
          return;
        }
        setSite(data as SiteInfo);
        onSite?.(data as SiteInfo);
        setStatus("ready");
      } catch {
        if (!cancelled) {
          setStatus("error");
          setError("Couldn't reach the map service.");
        }
      }
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // onSite is a callback prop; re-running when a parent re-renders would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // ── draw the lot and center on it ──
  useEffect(() => {
    const m = map.current;
    if (!m || !site?.job) return;
    parcelLayer.current?.clearLayers();

    if (countyLayer.current) {
      countyLayer.current.remove();
      countyLayer.current = null;
    }
    if (site.aerialService && !site.aerialService.includes("nationalmap.gov")) {
      countyLayer.current = exportTileLayer(site.aerialService, "County GIS aerials").addTo(m);
    }

    if (site.parcel?.ring?.length) {
      const poly = L.polygon(
        site.parcel.ring.map((p) => [p.lat, p.lng] as [number, number]),
        { color: "#FFD60A", weight: 3, fill: false, dashArray: "6 4", interactive: false }
      );
      poly.addTo(parcelLayer.current!);
      m.fitBounds(poly.getBounds(), { padding: [30, 30], maxZoom: 20 });
    } else {
      L.circleMarker([site.job.lat, site.job.lng], { radius: 7, color: C.amber, weight: 3 }).addTo(parcelLayer.current!);
      m.setView([site.job.lat, site.job.lng], 19);
    }
  }, [site]);

  // ── render saved measurements ──
  useEffect(() => {
    const layer = drawnLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const ms of measurements) {
      const latlngs = ms.points.map((p) => [p.lat, p.lng] as [number, number]);
      const shape =
        ms.kind === "area"
          ? L.polygon(latlngs, { color: C.green, weight: 3, fillOpacity: 0.25 })
          : L.polyline(latlngs, { color: "#3FA7FF", weight: 4 });
      shape.bindTooltip(`${ms.label}: ${describe(ms)}`, { permanent: true, direction: "center", className: "le-map-label" });
      shape.addTo(layer);
    }
  }, [measurements]);

  // ── render the in-progress drawing ──
  useEffect(() => {
    const layer = draftLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (draft.length === 0) return;
    const latlngs = draft.map((p) => [p.lat, p.lng] as [number, number]);
    draft.forEach((p) => L.circleMarker([p.lat, p.lng], { radius: 5, color: "#fff", fillColor: C.amber, fillOpacity: 1, weight: 2 }).addTo(layer));
    if (mode === "area" && draft.length >= 3) {
      L.polygon(latlngs, { color: C.amber, weight: 3, fillOpacity: 0.2, dashArray: "4 4" }).addTo(layer);
    } else if (draft.length >= 2) {
      L.polyline(latlngs, { color: C.amber, weight: 3, dashArray: "4 4" }).addTo(layer);
    }
  }, [draft, mode]);

  const liveText =
    mode === "area"
      ? draft.length >= 3
        ? `${fmt0(polygonAreaSqFt(draft))} sq ft`
        : `Tap the corners (${draft.length} so far)`
      : mode === "line"
        ? draft.length >= 2
          ? `${fmt0(lineLengthFt(draft))} ft`
          : `Tap the start, then each bend (${draft.length} so far)`
        : "";

  const fetchProfile = useCallback(async (points: LatLng[]): Promise<LineProfileInfo | null> => {
    try {
      const res = await fetch("/api/site/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points }),
      });
      if (!res.ok) return null;
      return (await res.json()) as LineProfileInfo;
    } catch {
      return null;
    }
  }, []);

  async function finish() {
    const pts = draftRef.current;
    const kind = modeRef.current;
    if (kind === "none") return;
    if ((kind === "area" && pts.length < 3) || (kind === "line" && pts.length < 2)) return;

    const n = measurements.filter((x) => x.kind === kind).length + 1;
    const ms: MapMeasurement =
      kind === "area"
        ? {
            id: `m${Date.now()}`,
            label: `Area ${n}`,
            kind,
            points: pts,
            sqft: Math.round(polygonAreaSqFt(pts)),
            ft: Math.round(polygonPerimeterFt(pts)),
          }
        : { id: `m${Date.now()}`, label: `Line ${n}`, kind, points: pts, ft: Math.round(lineLengthFt(pts)), profile: null };

    setDraft([]);
    setMode("none");
    const next = [...measurements, ms];
    onChange(next);

    if (kind === "line") {
      const profile = await fetchProfile(pts);
      if (profile) onChange(next.map((x) => (x.id === ms.id ? { ...x, profile } : x)));
    }
  }

  function addWholeLot() {
    const ring = site?.parcel?.ring;
    if (!ring) return;
    onChange([
      ...measurements,
      {
        id: `m${Date.now()}`,
        label: "Whole lot",
        kind: "area",
        points: ring,
        sqft: site!.parcel!.areaSqFt,
        ft: site!.parcel!.perimeterFt,
      },
    ]);
  }

  const btn = (active: boolean): React.CSSProperties => ({
    fontSize: 16,
    fontWeight: 700,
    padding: "10px 14px",
    borderRadius: 10,
    border: `2px solid ${active ? C.amber : C.green}`,
    background: active ? C.amber : "#fff",
    color: active ? C.black : C.green,
    cursor: "pointer",
  });

  return (
    <div style={{ border: `2px solid rgba(45,106,79,0.2)`, borderRadius: 14, overflow: "hidden", background: "#fff" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 12, alignItems: "center", borderBottom: `1px solid ${C.line}` }}>
        {mode === "none" ? (
          <>
            <button type="button" style={btn(false)} onClick={() => { setMode("area"); setDraft([]); }}>
              ▱ Measure an area
            </button>
            <button type="button" style={btn(false)} onClick={() => { setMode("line"); setDraft([]); }}>
              ╱ Measure a line
            </button>
            {site?.parcel && (
              <button type="button" style={btn(false)} onClick={addWholeLot}>
                ⬚ Use whole lot
              </button>
            )}
          </>
        ) : (
          <>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.black, marginRight: 4 }}>{liveText}</span>
            <button type="button" style={btn(true)} onClick={finish} disabled={(mode === "area" && draft.length < 3) || (mode === "line" && draft.length < 2)}>
              ✓ Done
            </button>
            <button type="button" style={btn(false)} onClick={() => setDraft((d) => d.slice(0, -1))} disabled={draft.length === 0}>
              ↶ Undo point
            </button>
            <button type="button" style={btn(false)} onClick={() => { setDraft([]); setMode("none"); }}>
              ✕ Cancel
            </button>
          </>
        )}
        <span style={{ marginLeft: "auto", fontSize: 13, color: C.grey }}>
          {status === "loading" && "Finding the property…"}
          {status === "error" && <span style={{ color: C.red }}>{error}</span>}
          {status === "ready" && site?.parcel && `Lot: ${fmt0(site.parcel.areaSqFt)} sq ft (county records)`}
          {status === "ready" && !site?.parcel && "No lot lines here — draw what you need"}
        </span>
      </div>

      <div ref={holder} style={{ height: 420, width: "100%", cursor: mode === "none" ? "grab" : "crosshair" }} />

      {(site?.grade || measurements.length > 0) && (
        <div style={{ padding: 12, borderTop: `1px solid ${C.line}`, display: "grid", gap: 8 }}>
          {site?.grade && (
            <div style={{ fontSize: 14, color: C.grey }}>
              Ground: {fmt1(site.grade.reliefFt)} ft of fall across the lot, water runs toward the {site.grade.drainsToward}.
            </div>
          )}
          {measurements.map((ms) => (
            <div key={ms.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: ms.kind === "area" ? C.green : "#3FA7FF" }} />
              <input
                value={ms.label}
                onChange={(e) => onChange(measurements.map((x) => (x.id === ms.id ? { ...x, label: e.target.value } : x)))}
                style={{ fontSize: 16, padding: "6px 8px", border: `1px solid ${C.line}`, borderRadius: 6, width: 180 }}
                aria-label="Measurement name"
              />
              <span style={{ fontSize: 16, fontWeight: 700 }}>{describe(ms)}</span>
              {ms.kind === "line" && ms.profile && ms.profile.worstRiseFt >= 0.3 && (
                <span style={{ fontSize: 13, color: C.red }}>hump of {fmt1(ms.profile.worstRiseFt)} ft along the way</span>
              )}
              {ms.kind === "line" && ms.profile === null && <span style={{ fontSize: 13, color: C.grey }}>checking ground…</span>}
              <button
                type="button"
                onClick={() => onChange(measurements.filter((x) => x.id !== ms.id))}
                style={{ marginLeft: "auto", border: "none", background: "none", color: C.red, fontSize: 18, cursor: "pointer" }}
                aria-label={`Remove ${ms.label}`}
              >
                ✕
              </button>
            </div>
          ))}
          <div style={{ fontSize: 12, color: C.grey }}>
            Tip: name each one for what it is (&ldquo;front bed&rdquo;, &ldquo;drain along east fence&rdquo;) — the estimator reads the names.
          </div>
        </div>
      )}

      <style>{`
        .le-map-label {
          background: rgba(26,26,26,0.78); color: #fff; border: none; box-shadow: none;
          font-size: 13px; font-weight: 700; padding: 3px 7px; border-radius: 6px;
        }
        .le-map-label::before { display: none; }
      `}</style>
    </div>
  );
}
