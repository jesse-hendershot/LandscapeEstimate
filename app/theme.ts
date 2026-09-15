/**
 * Shared palette, lifted out of app/page.tsx so the catalog screen and the
 * estimator can't drift apart. Same values, single source.
 */
export const C = {
  green: "#2D6A4F",
  amber: "#F4A231",
  bg: "#F9F6F0",
  black: "#1A1A1A",
  red: "#C0392B",
  yellow: "#FFFDE7",
  lgn: "#F0F7F4",
  grey: "#6B6B6B",
  line: "#E2DDD2",
  white: "#FFFFFF",
} as const;

export const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "3 days ago" — used to flag catalog prices that have gone stale. */
export function since(iso: string | Date | null | undefined): string {
  if (!iso) return "never";
  const then = typeof iso === "string" ? new Date(iso) : iso;
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

/** Past this, a catalog price is old enough to be worth a second look. */
export const STALE_DAYS = 60;

export function isStale(iso: string | Date | null | undefined): boolean {
  if (!iso) return true;
  const then = typeof iso === "string" ? new Date(iso) : iso;
  return (Date.now() - then.getTime()) / 86400000 > STALE_DAYS;
}
