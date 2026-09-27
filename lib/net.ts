/**
 * Outbound HTTP with a deadline.
 *
 * Every public data source this app leans on — the Census geocoder, the county
 * GIS, USGS elevation, EIA — is free, and free services have bad days. A slow
 * one must never hold an estimate hostage, so every call here has a timeout and
 * every caller treats failure as "unknown", not as an error.
 */

export const USER_AGENT =
  "LandscapeEstimate/1.0 (+https://landscape-estimate.vercel.app; contractor estimating tool)";

export async function fetchWithTimeout(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 8000, headers, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      headers: { "User-Agent": USER_AGENT, ...(headers ?? {}) },
      signal: ctrl.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) throw new Error(`${new URL(url).host} returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Run `fn` over `items` with at most `limit` in flight. Order preserved. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Resolve to `fallback` instead of throwing, and never take longer than `ms`. */
export async function settle<T>(p: Promise<T>, fallback: T, ms = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
