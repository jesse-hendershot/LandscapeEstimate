/**
 * Pulling JSON out of a model response.
 *
 * Previously inlined and duplicated across both routes. Centralised so the two
 * can't drift, and so the failure cases return something the caller can act on
 * instead of a bare null.
 */

import type { Message } from "@anthropic-ai/sdk/resources/messages.js";

export type ParseOutcome<T> =
  | { ok: true; value: T; raw: string }
  | { ok: false; reason: "no_text" | "no_json" | "invalid_json"; raw: string; error?: string };

/** The last text block — the model's answer lands after any tool_use blocks. */
export function lastText(response: Message): string {
  for (let i = response.content.length - 1; i >= 0; i--) {
    const block = response.content[i];
    if (block.type === "text") return block.text.trim();
  }
  return "";
}

export function extractJson<T = unknown>(response: Message): ParseOutcome<T> {
  const raw = lastText(response);
  if (!raw) return { ok: false, reason: "no_text", raw: "" };

  let s = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  if (!s.startsWith("{")) {
    const match = s.match(/\{[\s\S]*\}/);
    if (!match) return { ok: false, reason: "no_json", raw };
    s = match[0];
  }

  try {
    return { ok: true, value: JSON.parse(s) as T, raw };
  } catch (err) {
    return {
      ok: false,
      reason: "invalid_json",
      raw,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
