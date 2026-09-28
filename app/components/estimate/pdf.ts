/**
 * Customer-ready PDF. Lifted out of the page component; same layout as
 * before, plus hauling, machine fuel and pallet-deposit rows.
 */

import type { LineItem } from "./types";
import { fmt, type Totals } from "./totals";

export async function downloadEstimatePdf(args: {
  contractor: string;
  address: string;
  items: LineItem[];
  totals: Totals;
  haulLabel: string;
  machineLabel?: string;
  depositLabel: string;
  taxLabel: string;
  markupPct: number;
  clarifications: string[];
  notes: string;
}) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const { contractor, address, items, totals: t, markupPct } = args;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const green: [number, number, number] = [45, 106, 79];
  const ink: [number, number, number] = [26, 26, 26];
  const cream: [number, number, number] = [249, 246, 240];

  doc.setFillColor(...green);
  doc.rect(0, 0, W, 72, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.text("LandscapeEstimate", M, 44);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  doc.text(`${contractor ? contractor + "  ·  " : ""}${dateStr}`, M, 62);

  let y = 94;
  doc.setTextColor(...ink);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Job Address:", M, y);
  doc.setFont("helvetica", "normal");
  doc.text(address, M + 100, y);
  y += 30;

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Itemized Materials", M, y);
  y += 10;

  const last = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  autoTable(doc, {
    startY: y,
    head: [["Material", "Qty", "Unit", "Low $", "High $", "Source"]],
    body: items.map((i) => [i.material, i.qty, i.unit, `$${fmt(i.low)}`, `$${fmt(i.high)}`, i.source]),
    margin: { left: M, right: M },
    styles: { fontSize: 10, cellPadding: 6, textColor: ink },
    headStyles: { fillColor: green, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 11 },
    alternateRowStyles: { fillColor: cream },
    columnStyles: {
      1: { halign: "right", cellWidth: 35 },
      2: { cellWidth: 52 },
      3: { halign: "right", cellWidth: 55 },
      4: { halign: "right", cellWidth: 55 },
    },
  });
  y = last() + 16;

  const bottom: string[][] = [["Subtotal", "", "", `$${fmt(t.subLow)}`, `$${fmt(t.subHigh)}`, ""]];
  if (t.haul > 0) bottom.push(["Hauling & delivery", "", "", `$${fmt(t.haul)}`, `$${fmt(t.haul)}`, args.haulLabel]);
  if (t.machine > 0) bottom.push(["Machine fuel", "", "", `$${fmt(t.machine)}`, `$${fmt(t.machine)}`, args.machineLabel ?? ""]);
  if (t.deposit > 0) bottom.push(["Pallet deposits (refundable)", "", "", `$${fmt(t.deposit)}`, `$${fmt(t.deposit)}`, args.depositLabel]);
  bottom.push([args.taxLabel, "", "", `$${fmt(t.taxLow)}`, `$${fmt(t.taxHigh)}`, ""]);

  autoTable(doc, {
    startY: y,
    body: bottom,
    margin: { left: M, right: M },
    styles: { fontSize: 11, cellPadding: 6, textColor: ink, fontStyle: "bold" },
    alternateRowStyles: { fillColor: cream },
    columnStyles: {
      1: { cellWidth: 35 },
      2: { cellWidth: 52 },
      3: { halign: "right", cellWidth: 68 },
      4: { halign: "right", cellWidth: 68 },
      5: { fontStyle: "normal", fontSize: 8 },
    },
  });
  y = last();

  autoTable(doc, {
    startY: y,
    theme: "plain", // body-only: the default "striped" theme overrides fillColor and hides white text
    body: [["GRAND TOTAL", "", "", `$${fmt(t.grandLow)}`, `$${fmt(t.grandHigh)}`, ""]],
    margin: { left: M, right: M },
    bodyStyles: { fillColor: green, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 14, cellPadding: 10 },
    columnStyles: {
      1: { cellWidth: 35 },
      2: { cellWidth: 52 },
      3: { halign: "right", cellWidth: 90 },
      4: { halign: "right", cellWidth: 90 },
    },
  });
  y = last() + 24;
  if (y > H - 220) {
    doc.addPage();
    y = 40;
  }

  const midpoint = (t.grandLow + t.grandHigh) / 2;
  const mrk = midpoint * (markupPct / 100);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...ink);
  doc.text("Suggested Customer Quote", M, y);
  y += 18;
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`Markup applied: ${markupPct}%`, M, y);
  y += 15;
  doc.text(`Materials, hauling & tax (midpoint): $${fmt(midpoint)}`, M, y);
  y += 15;
  doc.text(`Markup amount: $${fmt(mrk)}`, M, y);
  y += 15;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...green);
  doc.text(`Charge the customer: $${fmt(midpoint + mrk)}`, M, y);
  y += 28;
  doc.setTextColor(...ink);

  if (args.clarifications.length) {
    if (y > H - 140) {
      doc.addPage();
      y = 40;
    }
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Still to confirm", M, y);
    y += 16;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    for (const c of args.clarifications) {
      const lines = doc.splitTextToSize(`• ${c}`, W - M * 2);
      if (y + lines.length * 14 > H - 55) {
        doc.addPage();
        y = 40;
      }
      doc.text(lines, M, y);
      y += lines.length * 14 + 4;
    }
    y += 8;
  }

  if (args.notes) {
    if (y > H - 100) {
      doc.addPage();
      y = 40;
    }
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Notes", M, y);
    y += 16;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(doc.splitTextToSize(args.notes, W - M * 2), M, y);
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFillColor(...cream);
    doc.rect(0, H - 36, W, 36, "F");
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(120, 120, 120);
    doc.text("Materials estimate — prices subject to change. Valid 30 days from generation date. Produced by LandscapeEstimate.", M, H - 14);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 14, { align: "right" });
  }

  doc.save(`estimate-${address.replace(/[^a-z0-9]/gi, "-")}.pdf`);
}
