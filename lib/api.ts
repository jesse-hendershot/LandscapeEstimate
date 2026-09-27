/**
 * Route-handler plumbing shared by the newer API routes: auth, JSON errors,
 * and one place that turns a thrown error into the right status code.
 */

import { NextResponse } from "next/server";
import type { z } from "zod";

import { authErrorResponse } from "./auth";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function parseOr400<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, "Invalid input", { fields: fieldErrors(r.error) });
  return r.data;
}

export async function handle(label: string, fn: () => Promise<Response | object>): Promise<Response> {
  try {
    const out = await fn();
    return out instanceof Response ? out : NextResponse.json(out);
  } catch (err) {
    const unauth = authErrorResponse(err);
    if (unauth) return unauth;
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(message)) {
      return NextResponse.json({ error: "That name is already used — pick another." }, { status: 409 });
    }
    console.error(`${label} failed`, err);
    return NextResponse.json({ error: `${label} failed` }, { status: 500 });
  }
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
