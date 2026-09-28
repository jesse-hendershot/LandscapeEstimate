/**
 * The estimate pipeline, start to finish.
 *
 *   site      geocode, parcel, grade, aerial photo, drawn measurements
 *   model     read the job + site, pick materials and quantities (dims)
 *   build     price from the catalog, compute quantities from dims
 *   gates     deterministic checks; one targeted repair pass if needed
 *   locality  substitutes by delivered cost, haul plan, deposits
 *   totals    tax on the configured scope, grand total
 *   persist   estimate, lines, run log
 *
 * Each stage past the model is arithmetic. The route handler is a thin shell
 * around `runEstimate`.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Message, MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { and, eq } from "drizzle-orm";

import { listMaterials, recordUsage, seedCatalogIfEmpty } from "../catalog/repo";
import { db } from "../db";
import { estimateLines, estimateRuns, estimates, type Profile } from "../db/schema";
import { localityOf } from "../geo/geocode";
import { currentDiesel } from "../haul/fuel";
import { fromCents } from "../money";
import { buildSiteContext, siteContextText, siteSummary, type Measurement } from "../site/context";
import { listSuppliers } from "../suppliers/repo";
import { listTrucks, seedTrucksIfEmpty } from "../trucks/repo";
import { buildEstimate, toLineItems, type BuildOptions, type ModelOutput } from "./build";
import { applyLocality } from "./locality";
import { extractJson } from "./parse";
import { systemPrompt, userMessage } from "./prompt";
import { repairInstruction, verifyBuild } from "./verifyBuild";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Model tier is configuration, not a constant.
const MODEL = process.env.ESTIMATE_MODEL ?? "claude-opus-4-8";
const REPAIR_MODEL = process.env.ESTIMATE_REPAIR_MODEL ?? MODEL;
const SEARCH_FIRST_PASS = process.env.ESTIMATE_SEARCH_FIRST !== "false";
const WEB_SEARCH = { type: "web_search_20250305", name: "web_search" } as const;

const STALE_DAYS = 60;

export interface EstimateInput {
  jobAddress: string;
  jobDescription: string;
  contractorName: string;
  measurements: Measurement[];
  trucksForJob: number | null;
  /** Clarification answers, "Q: ...\nA: ..." blocks. */
  answers: string;
  /** Estimate being refined; its model output becomes the prior turn. */
  previousEstimateId: string | null;
}

export class InputError extends Error {}

function runId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Validate an untrusted request body into an EstimateInput. */
export function parseEstimateInput(body: Record<string, unknown>): EstimateInput {
  const jobAddress = String(body.jobAddress ?? "").trim().slice(0, 300);
  const jobDescription = String(body.jobDescription ?? "").trim().slice(0, 8000);
  if (!jobAddress || !jobDescription) throw new InputError("jobAddress and jobDescription are required");

  const measurements: Measurement[] = [];
  if (Array.isArray(body.measurements)) {
    for (const raw of body.measurements.slice(0, 20)) {
      const m = raw as Record<string, unknown>;
      const kind = m.kind === "line" ? "line" : m.kind === "area" ? "area" : null;
      if (!kind || !Array.isArray(m.points)) continue;
      const points = (m.points as unknown[])
        .map((p) => p as { lat?: unknown; lng?: unknown })
        .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
        .slice(0, 200)
        .map((p) => ({ lat: p.lat as number, lng: p.lng as number }));
      if (points.length < 2) continue;
      measurements.push({
        id: String(m.id ?? measurements.length),
        label: String(m.label ?? (kind === "area" ? "Area" : "Line")).slice(0, 60),
        kind,
        points,
        sqft: typeof m.sqft === "number" ? m.sqft : undefined,
        ft: typeof m.ft === "number" ? m.ft : undefined,
      });
    }
  }

  const t = Number(body.trucksForJob);
  return {
    jobAddress,
    jobDescription,
    contractorName: String(body.contractorName ?? "").trim().slice(0, 160),
    measurements,
    trucksForJob: Number.isFinite(t) && t >= 1 && t <= 10 ? Math.floor(t) : null,
    answers: String(body.answers ?? "").trim().slice(0, 6000),
    previousEstimateId:
      typeof body.previousEstimateId === "string" && /^[0-9a-f-]{36}$/i.test(body.previousEstimateId)
        ? body.previousEstimateId
        : null,
  };
}

export async function runEstimate(profile: Profile, input: EstimateInput) {
  const rid = runId();
  const startedAt = Date.now();
  const ownerId = profile.id;

  await Promise.all([seedCatalogIfEmpty(ownerId), seedTrucksIfEmpty(ownerId)]);
  const [catalog, suppliers, trucks] = await Promise.all([
    listMaterials(ownerId),
    listSuppliers(ownerId, { includeInactive: true }),
    listTrucks(ownerId),
  ]);

  const bias = localityOf(profile.shopAddress) || "Iowa City, IA";

  // Refinement: reuse the prior model output so the answers adjust the list
  // rather than regenerate it from scratch.
  let previous: { modelOutput: unknown; measurements: Measurement[] } | null = null;
  if (input.previousEstimateId) {
    const [row] = await db
      .select({ modelOutput: estimates.modelOutput, site: estimates.site })
      .from(estimates)
      .where(and(eq(estimates.ownerId, ownerId), eq(estimates.id, input.previousEstimateId)))
      .limit(1);
    if (row) {
      const prevSite = row.site as { measurements?: Measurement[] } | null;
      previous = { modelOutput: row.modelOutput, measurements: prevSite?.measurements ?? [] };
    }
  }
  const measurements = input.measurements.length ? input.measurements : previous?.measurements ?? [];

  const [site, diesel] = await Promise.all([
    buildSiteContext(input.jobAddress, { bias, measurements }),
    currentDiesel(profile),
  ]);

  const system = systemPrompt(catalog, suppliers);
  const siteText = siteContextText(site);
  const firstUserText = userMessage({
    contractorName: input.contractorName,
    jobAddress: input.jobAddress,
    jobDescription: input.jobDescription,
    siteText,
    answers: previous ? "" : input.answers,
  });

  const firstUserContent: MessageParam["content"] = site.aerial
    ? [
        {
          type: "image",
          source: { type: "base64", media_type: site.aerial.mediaType, data: site.aerial.base64 },
        },
        { type: "text", text: firstUserText },
      ]
    : firstUserText;

  const messages: MessageParam[] = [{ role: "user", content: firstUserContent }];
  if (previous?.modelOutput && input.answers) {
    messages.push({ role: "assistant", content: JSON.stringify(previous.modelOutput) });
    messages.push({
      role: "user",
      content:
        "THE CONTRACTOR ANSWERED YOUR QUESTIONS:\n" +
        input.answers +
        "\n\nReturn the COMPLETE updated JSON in the same format. Keep everything the answers don't affect. Only ask new questions if something important is still unknown.",
    });
  }

  const first = (await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    ...(SEARCH_FIRST_PASS ? { tools: [WEB_SEARCH] } : {}),
    messages,
  } as Parameters<typeof client.messages.create>[0])) as Message;

  let inputTokens = first.usage?.input_tokens ?? 0;
  let outputTokens = first.usage?.output_tokens ?? 0;

  const parsed = extractJson<ModelOutput>(first);
  if (!parsed.ok) {
    console.error("estimate parse failed", { rid, reason: parsed.reason, stop_reason: first.stop_reason });
    throw new InputError("Couldn't read the materials list. Try rephrasing the job description.");
  }

  const buildOpts: BuildOptions = {
    taxRateBps: profile.taxRateBps,
    markupBps: 0,
    taxHaul: profile.taxHaul,
    taxDeposits: profile.taxDeposits,
  };

  let modelOutput = parsed.value;
  let built = buildEstimate(modelOutput, catalog, buildOpts);
  let verdict = verifyBuild(built);
  let repaired = false;
  let repairSucceeded: boolean | undefined;

  if (!verdict.passed && verdict.repairable) {
    repaired = true;
    const needsSearch = verdict.errors.some((e) => e.gate === "sources");
    try {
      const repair = (await client.messages.create({
        model: REPAIR_MODEL,
        max_tokens: 8000,
        system,
        ...(needsSearch ? { tools: [WEB_SEARCH] } : {}),
        messages: [
          ...messages,
          { role: "assistant", content: JSON.stringify(parsed.value) },
          { role: "user", content: repairInstruction(verdict.errors, built) },
        ],
      } as Parameters<typeof client.messages.create>[0])) as Message;

      inputTokens += repair.usage?.input_tokens ?? 0;
      outputTokens += repair.usage?.output_tokens ?? 0;

      const reparsed = extractJson<ModelOutput>(repair);
      if (reparsed.ok) {
        const rebuilt = buildEstimate(reparsed.value, catalog, buildOpts);
        const reverdict = verifyBuild(rebuilt);
        if (reverdict.errors.length < verdict.errors.length) {
          built = rebuilt;
          verdict = reverdict;
          modelOutput = reparsed.value;
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

  // ── locality: substitutes, haul, deposits, totals ──
  const trucksForJob = input.trucksForJob ?? profile.trucksPerJob;
  const loc = await applyLocality({
    built,
    catalog,
    suppliers,
    trucks,
    profile,
    job: site.job,
    trucksForJob,
    diesel,
    bias,
    buildOpts,
  });
  built = loc.built;

  // Stale catalog prices on this estimate.
  const staleNames = built.lines
    .filter((l) => l.fromCatalog && l.materialId)
    .map((l) => catalog.find((m) => m.id === l.materialId))
    .filter((m) => m && (Date.now() - m.priceUpdatedAt.getTime()) / 86_400_000 > STALE_DAYS)
    .map((m) => m!.name);
  const warnings = [...loc.detail.warnings];
  if (staleNames.length) {
    warnings.push(`Prices not checked in over ${STALE_DAYS} days: ${staleNames.join(", ")}.`);
  }

  const lineItems = toLineItems(built, profile.taxRateBps, buildOpts);
  const summary = siteSummary(site);

  // ── persist ──
  let estimateId: string | null = null;
  try {
    const [row] = await db
      .insert(estimates)
      .values({
        ownerId,
        contractorName: input.contractorName,
        jobAddress: input.jobAddress,
        jobDescription: input.jobDescription + (input.answers ? `\n\nAnswers:\n${input.answers}` : ""),
        markupBps: profile.defaultMarkupBps,
        taxRateBps: profile.taxRateBps,
        taxHaul: profile.taxHaul,
        taxDeposits: profile.taxDeposits,
        subtotalLowCents: built.subtotalLowCents,
        subtotalHighCents: built.subtotalHighCents,
        deliveryLowCents: built.deliveryLowCents,
        deliveryHighCents: built.deliveryHighCents,
        depositCents: built.depositCents,
        taxLowCents: built.taxLowCents,
        taxHighCents: built.taxHighCents,
        totalLowCents: built.totalLowCents,
        totalHighCents: built.totalHighCents,
        notes: built.notes,
        clarifications: built.clarifications,
        verification: { errors: verdict.errors, warnings: verdict.warnings },
        runId: rid,
        jobLat: site.job?.lat ?? null,
        jobLng: site.job?.lng ?? null,
        haulDetail: loc.detail,
        site: summary,
        modelOutput,
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
          basis: l.basis,
          haulCents: l.haulCents ?? 0,
          miles: l.miles ?? null,
          alternatives: l.alternatives ?? null,
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
      inputTokens,
      outputTokens,
    });
  } catch (err) {
    // A persistence failure must not cost the estimator their estimate.
    console.error("estimate persistence failed", { rid, err });
  }

  return {
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
    haul: loc.detail,
    site: summary,
    tax: { ratePct: profile.taxRateBps / 100, haul: profile.taxHaul, deposits: profile.taxDeposits },
    markupPct: profile.defaultMarkupBps / 100,
    trucksForJob,
    warnings,
  };
}

export type EstimateResponse = Awaited<ReturnType<typeof runEstimate>>;
