import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages.js";
import { NextRequest, NextResponse } from "next/server";

import { authErrorResponse, requireProfile } from "@/lib/auth";
import { listMaterials, recordUsage, seedCatalogIfEmpty } from "@/lib/catalog/repo";
import { db } from "@/lib/db";
import { estimateLines, estimateRuns, estimates } from "@/lib/db/schema";
import { buildEstimate, toLineItems, type ModelOutput } from "@/lib/estimate/build";
import { extractJson } from "@/lib/estimate/parse";
import { systemPrompt, userMessage } from "@/lib/estimate/prompt";
import { repairInstruction, verifyBuild } from "@/lib/estimate/verifyBuild";
import { fromCents } from "@/lib/money";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-opus-4-8";

export const maxDuration = 180;

function runId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function POST(req: NextRequest) {
  const rid = runId();
  const startedAt = Date.now();

  try {
    const profile = await requireProfile();
    const ownerId = profile.id;

    const body = await req.json();
    const jobAddress = String(body.jobAddress ?? "").trim();
    const jobDescription = String(body.jobDescription ?? "").trim();
    const contractorName = String(body.contractorName ?? "").trim();

    if (!jobAddress || !jobDescription) {
      return NextResponse.json(
        { error: "jobAddress and jobDescription are required" },
        { status: 400 }
      );
    }

    await seedCatalogIfEmpty(ownerId);
    const catalog = await listMaterials(ownerId);

    const system = systemPrompt(catalog);
    const user = userMessage({ contractorName, jobAddress, jobDescription });

    const first = (await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: user }],
    } as Parameters<typeof client.messages.create>[0])) as Message;

    const parsed = extractJson<ModelOutput>(first);
    if (!parsed.ok) {
      console.error("estimate parse failed", {
        rid,
        reason: parsed.reason,
        stop_reason: first.stop_reason,
        head: parsed.raw.slice(0, 300),
      });
      return NextResponse.json(
        { error: "Couldn't read the materials list. Try rephrasing the job description." },
        { status: 500 }
      );
    }

    const opts = { taxRateBps: profile.taxRateBps, markupBps: 0 };
    let built = buildEstimate(parsed.value, catalog, opts);
    let verdict = verifyBuild(built);
    let repaired = false;
    let repairSucceeded: boolean | undefined;

    // One targeted repair pass. Web search only when a source was rejected —
    // that is the only failure class needing new information, and handing the
    // model search for a unit fix invites it to re-research prices that were
    // already fine.
    if (!verdict.passed && verdict.repairable) {
      repaired = true;
      const needsSearch = verdict.errors.some((e) => e.gate === "sources");

      try {
        const repair = (await client.messages.create({
          model: MODEL,
          max_tokens: 8000,
          system,
          ...(needsSearch
            ? { tools: [{ type: "web_search_20250305", name: "web_search" }] }
            : {}),
          messages: [
            { role: "user", content: user },
            { role: "assistant", content: JSON.stringify(parsed.value) },
            { role: "user", content: repairInstruction(verdict.errors, built) },
          ],
        } as Parameters<typeof client.messages.create>[0])) as Message;

        const reparsed = extractJson<ModelOutput>(repair);
        if (reparsed.ok) {
          const rebuilt = buildEstimate(reparsed.value, catalog, opts);
          const reverdict = verifyBuild(rebuilt);
          // Keep the repair only if it strictly improved. A pass that trades
          // three failures for four is a regression.
          if (reverdict.errors.length < verdict.errors.length) {
            built = rebuilt;
            verdict = reverdict;
            repairSucceeded = reverdict.passed;
          } else {
            repairSucceeded = false;
          }
        } else {
          repairSucceeded = false;
        }
      } catch (err) {
        console.error("repair pass failed", { rid, err });
        repairSucceeded = false;
      }
    }

    const lineItems = toLineItems(built, profile.taxRateBps);

    // ── persist ───────────────────────────────────────────────────────────
    let estimateId: string | null = null;
    try {
      const [row] = await db
        .insert(estimates)
        .values({
          ownerId,
          contractorName,
          jobAddress,
          jobDescription,
          markupBps: profile.defaultMarkupBps,
          taxRateBps: profile.taxRateBps,
          subtotalLowCents: built.subtotalLowCents,
          subtotalHighCents: built.subtotalHighCents,
          deliveryLowCents: built.deliveryLowCents,
          deliveryHighCents: built.deliveryHighCents,
          taxLowCents: built.taxLowCents,
          taxHighCents: built.taxHighCents,
          totalLowCents: built.totalLowCents,
          totalHighCents: built.totalHighCents,
          notes: built.notes,
          clarifications: built.clarifications,
          verification: { errors: verdict.errors, warnings: verdict.warnings },
          runId: rid,
        })
        .returning({ id: estimates.id });
      estimateId = row.id;

      if (built.lines.length > 0) {
        await db.insert(estimateLines).values(
          built.lines.map((l, i) => ({
            estimateId: row.id,
            position: i,
            materialId: l.materialId,
            fromCatalog: l.fromCatalog,
            material: l.material,
            qtyMilli: l.qtyMilli,
            unit: l.unit,
            unitLowCents: l.unitLowCents,
            unitHighCents: l.unitHighCents,
            source: l.source,
          }))
        );
      }

      await recordUsage(
        ownerId,
        built.lines.map((l) => l.materialId).filter((x): x is string => Boolean(x))
      );

      await db.insert(estimateRuns).values({
        runId: rid,
        ownerId,
        estimateId: row.id,
        passed: verdict.passed,
        repaired,
        repairSucceeded,
        gatesFailed: [...new Set([...verdict.errors, ...verdict.warnings].map((g) => g.gate))],
        gateDetail: [...verdict.errors, ...verdict.warnings].map((g) => ({
          gate: g.gate,
          severity: g.severity,
          detail: g.detail,
        })),
        catalogLines: built.catalogLineCount,
        researchedLines: built.customLineCount,
        latencyMs: Date.now() - startedAt,
        inputTokens: first.usage?.input_tokens,
        outputTokens: first.usage?.output_tokens,
      });
    } catch (err) {
      // A persistence failure must not cost the estimator their estimate. They
      // can still work from it and re-save; losing it to a database hiccup is
      // the worse outcome.
      console.error("estimate persistence failed", { rid, err });
    }

    // Response keeps the shape app/page.tsx already renders, so the existing
    // table, markup and PDF export keep working unchanged.
    return NextResponse.json({
      id: estimateId,
      runId: rid,
      line_items: lineItems,
      total_low: fromCents(built.totalLowCents),
      total_high: fromCents(built.totalHighCents),
      clarifications_needed: built.clarifications,
      notes: built.notes,
      verification: {
        passed: verdict.passed,
        repaired,
        gates: verdict.errors,
        warnings: verdict.warnings,
        catalogLines: built.catalogLineCount,
        researchedLines: built.customLineCount,
      },
    });
  } catch (err) {
    const unauth = authErrorResponse(err);
    if (unauth) return unauth;

    console.error("estimate route error", { rid, err });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
