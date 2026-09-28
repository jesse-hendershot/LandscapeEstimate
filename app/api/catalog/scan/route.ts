import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages.js";
import type { NextRequest } from "next/server";

import { HttpError, handle } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { listMaterials } from "@/lib/catalog/repo";
import { SCAN_PROMPT, normalizeScan, propose, similarity } from "@/lib/catalog/scan";
import { extractJson } from "@/lib/estimate/parse";
import { listSuppliers } from "@/lib/suppliers/repo";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.SCAN_MODEL ?? process.env.ESTIMATE_MODEL ?? "claude-opus-4-8";

export const maxDuration = 90;

const MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * POST /api/catalog/scan  { images: [{ data: base64, mediaType }], supplierId? }
 *
 * Reads receipts / scale tickets and PROPOSES catalog price updates. Writes
 * nothing — /api/catalog/scan/apply does, with the rows the estimator ticked.
 */
export async function POST(req: NextRequest) {
  return handle("read receipt", async () => {
    const ownerId = await requireOwner();
    const body = (await req.json()) as { images?: { data?: string; mediaType?: string }[]; supplierId?: string };
    const images = (body.images ?? [])
      .filter((i) => typeof i.data === "string" && i.data.length > 100 && MEDIA.has(String(i.mediaType)))
      .slice(0, 4);
    if (images.length === 0) throw new HttpError(400, "Attach a photo of the receipt or ticket.");
    const bytes = images.reduce((a, i) => a + (i.data!.length * 3) / 4, 0);
    if (bytes > 4_000_000) throw new HttpError(413, "Photos are too large — try one at a time.");

    const res = (await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((i) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: i.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: i.data!,
              },
            })),
            { type: "text" as const, text: SCAN_PROMPT },
          ],
        },
      ],
    })) as Message;

    const parsed = extractJson(res);
    if (!parsed.ok) throw new HttpError(422, "Couldn't read that photo. Try a sharper, straight-on shot.");
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
      scan,
      supplierId,
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
      proposals: propose(scan, catalog, supplierId),
    };
  });
}
