/**
 * Run log.
 *
 * Every estimate, the gates it tripped, and whether a repair fixed it. This is
 * the training set for anything learned later, and it costs one structured
 * console line per estimate.
 *
 * Vercel's filesystem is ephemeral, so this writes structured JSON to stdout
 * where the platform's log drain can pick it up. When you want durable history,
 * implement `RunSink` against Postgres/KV and pass it to `setSink` — nothing
 * else in the pipeline changes.
 *
 * The signal worth collecting is already in your UI: when a contractor edits a
 * line in the estimate table, that line was wrong. Post those edits back to
 * `/api/feedback` and you have labeled failures without hand-labeling anything.
 */

import type { GateResult, LineItem } from "./schema";

export interface RunRecord {
  runId: string;
  at: string;
  jobAddress: string;
  jobDescriptionLength: number;
  model: string;
  lineCount: number;
  passed: boolean;
  repaired: boolean;
  repairSucceeded?: boolean;
  usedSearchOnRepair?: boolean;
  gatesFailed: string[];
  gateDetail: { gate: string; severity: string; detail: string }[];
  totalLow: number;
  totalHigh: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** A line the contractor changed after we handed them the estimate. */
export interface EditRecord {
  runId: string;
  at: string;
  lineIndex: number;
  material: string;
  field: keyof LineItem;
  before: string | number;
  after: string | number;
}

export interface RunSink {
  run(record: RunRecord): void | Promise<void>;
  edit?(record: EditRecord): void | Promise<void>;
}

const consoleSink: RunSink = {
  run(record) {
    console.log("ESTIMATE_RUN " + JSON.stringify(record));
  },
  edit(record) {
    console.log("ESTIMATE_EDIT " + JSON.stringify(record));
  },
};

let sink: RunSink = consoleSink;

export function setSink(next: RunSink) {
  sink = next;
}

export function makeRunId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

export async function logRun(record: RunRecord): Promise<void> {
  try {
    await sink.run(record);
  } catch (err) {
    // Logging must never take an estimate down with it.
    console.error("run log failed", err);
  }
}

export async function logEdit(record: EditRecord): Promise<void> {
  try {
    await sink.edit?.(record);
  } catch (err) {
    console.error("edit log failed", err);
  }
}

export function summarizeGates(gates: GateResult[]): {
  failed: string[];
  detail: { gate: string; severity: string; detail: string }[];
} {
  const bad = gates.filter((g) => !g.passed);
  return {
    failed: [...new Set(bad.map((g) => g.gate))],
    detail: bad.map((g) => ({ gate: g.gate, severity: g.severity, detail: g.detail })),
  };
}
