import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam, Message } from "@anthropic-ai/sdk/resources/messages.js";
import type { NextRequest } from "next/server";

import { HttpError, handle } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { listMaterials } from "@/lib/catalog/repo";
import { SCAN_PROMPT, SHEET_PROMPT, normalizeScan, propose, similarity } from "@/lib/catalog/scan";
import { extractJson } from "@/lib/estimate/parse";
import { listSuppliers } from "@/lib/suppliers/repo";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.SCAN_MODEL ?? process.env.ESTIMATE_MODEL ?? "claude-opus-4-8";

export const maxDuration = 120;

const IMAGE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 4_000_000;

/**
 * POST /api/catalog/scan
 *   { kind?: "receipt" | "sheet", images?: [{ data, mediaType }], pdf?: { data }, text?, supplierId? }
 *
 * Reads receipts, scale tickets or a supplier's price sheet (photos, a PDF, or
 * pasted text) and PROPOSES catalog price updates. Writes nothing —
 * /api/catalog/scan/apply does, with the rows the estimator ticked.
 */
export async function POST(req: NextRequest) {
  return handle("read prices", async () => {
    const ownerId = await requireOwner();
    const body = (await req.json()) as {
      kind?: string;
      images?: { data?: string; mediaType?: string }[];
      pdf?: { data?: string };
      text?: string;
      supplierId?: string;
      /** A result already read: re-match it (e.g. for another supplier) without reading again. */
      scan?: unknown;
    };
    const kind = body.kind === "sheet" ? "sheet" : "receipt";

    if (body.scan) {
      const scan = normalizeScan(body.scan);
      const [catalog, suppliers] = await Promise.all([listMaterials(ownerId), listSuppliers(ownerId)]);
      const supplierId = body.supplierId && suppliers.some((s) => s.id === body.supplierId) ? body.supplierId : null;
      return {
        kind,
        scan,
        supplierId,
        suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, deliveryFee: s.deliveryFeeCents / 100 })),
        proposals: propose(scan, catalog, supplierId),
      };
    }

    const images = (body.images ?? [])
      .filter((i) => typeof i.data === "string" && i.data.length > 100 && IMAGE.has(String(i.mediaType)))
      .slice(0, 6);
    const pdf = typeof body.pdf?.data === "string" && body.pdf.data.length > 100 ? body.pdf.data : null;
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 30_000) : "";
    if (images.length === 0 && !pdf && !text) {
      throw new HttpError(400, kind === "sheet" ? "Attach the price sheet (photo or PDF) or paste its text." : "Attach a photo of the receipt or ticket.");
    }
    const bytes = images.reduce((a, i) => a + (i.data!.length * 3) / 4, 0) + (pdf ? (pdf.length * 3) / 4 : 0);
    if (bytes > MAX_BYTES) throw new HttpError(413, "That's too large to read in one go — try fewer pages or photos.");

    const content: ContentBlockParam[] = [
      ...images.map((i) => ({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: i.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
          data: i.data!,
        },
      })),
      ...(pdf ? [{ type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: pdf } }] : []),
      ...(text ? [{ type: "text" as const, text: `THE ${kind === "sheet" ? "PRICE LIST" : "RECEIPT"} AS TEXT:\n${text}` }] : []),
      { type: "text" as const, text: kind === "sheet" ? SHEET_PROMPT : SCAN_PROMPT },
    ];

    const res = (await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content }],
    })) as Message;

    const parsed = extractJson(res);
    if (!parsed.ok) {
      throw new HttpError(422, kind === "sheet" ? "Couldn't read that price sheet. Try a sharper photo or paste the text." : "Couldn't read that photo. Try a sharper, straight-on shot.");
    }
    const scan = normalizeScan(parsed.value);

    const [catalog, suppliers] = await Promise.all([listMaterials(ownerId), listSuppliers(ownerId)]);

    let supplierId = body.supplierId && suppliers.some((s) => s.id === body.supplierId) ? body.supplierId : null;
    if (!supplierId && scan.supplier.name) {
      const best = suppliers
        .map((s) => ({ s, score: similarity(scan.supplier.name, s.name) }))
        .sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= 0.6) supplierId = best.s.id;
    }

    return {
      kind,
      scan,
      supplierId,
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, deliveryFee: s.deliveryFeeCents / 100 })),
      proposals: propose(scan, catalog, supplierId),
    };
  });
}
