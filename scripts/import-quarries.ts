/**
 * Rebuild data/msha-quarries.json from MSHA's Mines data set.
 *
 *   npx tsx scripts/import-quarries.ts
 *
 * Runs monthly via .github/workflows/quarries.yml. The zip is ~7 MB and holds
 * one pipe-delimited file, Mines.txt, with every mine MSHA has ever registered
 * (~92,000 rows). We keep the few hundred that a landscaper in or around Iowa
 * could buy rock from.
 *
 * No zip library: the archive has a single deflated entry, so reading its local
 * header and inflating the body with zlib is a dozen lines.
 */

import { writeFileSync } from "node:fs";

import { parseMines, unzipSingle } from "../lib/suppliers/msha";

const URL_ = "https://arlweb.msha.gov/OpenGovernmentData/DataSets/Mines.zip";

async function main() {
  const res = await fetch(URL_, { headers: { "User-Agent": "LandscapeEstimate quarry import" } });
  if (!res.ok) throw new Error(`MSHA returned HTTP ${res.status}`);
  const text = unzipSingle(Buffer.from(await res.arrayBuffer()));

  const rows = parseMines(text);

  const out = {
    source: "MSHA Mines Data Set (arlweb.msha.gov/OpenGovernmentData/DataSets/Mines.zip)",
    generated: new Date().toISOString().slice(0, 10),
    filter:
      "Metal/nonmetal; status Active or Intermittent; primary SIC crushed/dimension stone or construction sand & gravel; within lat 40.0-43.8, lng -97.0 to -89.8; fixed sites (portable crushing crews excluded unless named for a place)",
    fields: ["id", "name", "operator", "state", "county", "lat", "lng", "kind", "status", "town", "directions"],
    rows,
  };

  // Guard against a truncated download silently emptying the list.
  if (rows.length < 50) throw new Error(`only ${rows.length} quarries matched — refusing to overwrite`);

  const json =
    "{\n" +
    Object.entries(out)
      .map(([k, v]) =>
        k === "rows"
          ? `  "rows": [\n${(v as unknown[]).map((r) => "    " + JSON.stringify(r)).join(",\n")}\n  ]`
          : `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`
      )
      .join(",\n") +
    "\n}\n";
  writeFileSync("data/msha-quarries.json", json);
  console.log(`wrote ${rows.length} quarries`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
