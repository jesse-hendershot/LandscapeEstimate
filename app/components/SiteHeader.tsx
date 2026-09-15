import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";

import { C } from "../theme";

/**
 * Server component. `<Show>` is async and server-only — it replaced
 * `<SignedIn>`/`<SignedOut>`, which were removed in Clerk Core 3 and now throw
 * if rendered.
 */
export default function SiteHeader() {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "12px 20px",
        borderBottom: `1px solid ${C.line}`,
        background: C.white,
        flexWrap: "wrap",
      }}
    >
      <Link
        href="/"
        style={{
          fontWeight: 700,
          fontSize: 17,
          color: C.green,
          textDecoration: "none",
          letterSpacing: "-0.01em",
        }}
      >
        LandscapeEstimate
      </Link>

      <Show when="signed-in">
        <nav style={{ display: "flex", gap: 16, fontSize: 14 }}>
          <Link href="/" style={{ color: C.black, textDecoration: "none" }}>
            New estimate
          </Link>
          <Link href="/catalog" style={{ color: C.black, textDecoration: "none" }}>
            Materials
          </Link>
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
          <UserButton />
        </div>
      </Show>

      <Show when="signed-out">
        <div style={{ marginLeft: "auto", fontSize: 14 }}>
          <Link href="/sign-in" style={{ color: C.green, fontWeight: 600 }}>
            Sign in
          </Link>
        </div>
      </Show>
    </header>
  );
}
