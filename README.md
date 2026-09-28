# LandscapeEstimate

**[Open the live app](https://landscape-estimate.vercel.app/)** · [Run it yourself](#running-it-yourself)

A materials cost estimator for landscape contractors. Describe the job in plain English, get a priced materials list, apply your markup, hand the customer a PDF.

> Sign-up is free and takes a few seconds. Your catalog and estimates are scoped to your own account.


A materials cost estimator for landscape contractors. Describe the job in plain English, get a priced materials list, apply your markup, hand the customer a PDF.

<img width="944" height="532" alt="Screenshot 2026-09-16 005625" src="https://github.com/user-attachments/assets/dd1b5b4d-777d-41df-84f9-d083b7d4d2be" />
<img width="947" height="527" alt="Screenshot 2026-09-16 010713" src="https://github.com/user-attachments/assets/d319269f-de7e-49b7-b9d6-43820d1e77ff" />
<img width="942" height="502" alt="Screenshot 2026-09-16 010750" src="https://github.com/user-attachments/assets/7f917465-5459-4ea6-b749-1a4d8a6e5da5" />


## Why I built it

I've worked at a landscape contracting company since 2022. Quotes there get built by hand — an estimator looks up material prices one item at a time, adds margin on paper, and writes a number down. It's slow, it's inconsistent between jobs, and the prices are usually whatever was true the last time somebody checked. That produces estimates that are either inflated or leave money on the table.

This collapses that into a single text box.

## How it works

The shop keeps a **catalog** — the things it buys every week, at its real prices, linked to the supplier it buys them from. The model never sees a catalog price and never supplies one. It reads the job, picks materials, and returns a catalog id and a quantity (or, better, the dimensions); the server applies the price and does the math.

That has three consequences worth stating plainly:

- **A catalog line cannot have a wrong price.** A wrong price is wrong in exactly one place, where one person fixes it once for every future job.
- **The model does no arithmetic.** Quantities from dimensions (with compaction and tons-per-yard), hauling, deposits, tax and the grand total are all computed in TypeScript. Money is integer cents everywhere; no float touches a number a contractor reads.
- **Materials are priced delivered, not on the shelf.** A quarry 30 miles out that's $6/ton cheaper usually costs more once the diesel and truck time are counted. The locality engine prices every interchangeable material, from every supplier, *delivered to this job address*, and keeps the cheapest.

Anything off-catalog — a specific plant, an odd block — gets researched with web search, and those lines are flagged with their source so you can see which numbers are solid and which are estimates.

### Locality

Everything is measured from the job site:

- Each bulk load is a round trip job → supplier → job. Loads are split across the trucks on the job (biggest first), by weight **and** by bed volume — light material fills the bed before it hits the scale limit.
- Store runs (bags, rolls, pipe) are one round trip per store, however many items.
- Each truck that goes out adds one shop → job → shop trip at the end. More trucks finish sooner; each one adds its own shop trip.
- Every trip costs fuel (miles ÷ mpg × this week's diesel) plus time (hours × the truck's hourly cost, which covers driver and wear but not fuel).

Diesel is the EIA's weekly Midwest retail price, refreshed automatically. Road miles come from OpenRouteService's truck profile when a key is set, otherwise straight-line × 1.3 (flagged "approx" everywhere it shows).

Materials that do the same job share a **substitute group** in the catalog ("Drain rock" might hold 3/4 in clean limestone from one quarry and #57 from another). The shop decides what's interchangeable; the app never guesses. Each estimate line shows the alternatives, priced delivered, with a one-click swap.

### The site

Type an address and the app pulls the lot from the county's parcel records (Johnson County today), the ground elevation from USGS lidar, and a 2025 aerial photo. The model gets the photo, where the lot lines fall on it, and the scale, so "drainage project" comes back with a sensible drain run along the right side of the lot. Tap **Measure on the map** to outline beds or draw a drain run for exact numbers — a drawn line reports how much the ground falls along it.

### Finding suppliers

Every active quarry and sand & gravel pit registered with the federal Mine Safety and Health Administration is searchable by distance from the shop or a job, and can be added as a supplier in one click. Photos of receipts and scale tickets update catalog prices: the model reads the paper, a person ticks which changes to apply.

### Field test

Every estimate is saved. The field-test page puts the app's total next to the hand estimate, the time each took, and the actual job cost — and every edit made to a generated estimate is logged as a correction, which is the label set for improving it.

## Features

- **Plain-English job entry.** Two words is enough; the site data fills in the rest.
- **Property map.** County lot lines, aerial photo, draw areas and lines, ground fall along a drain.
- **Delivered-cost pricing.** Substitutes compared by material + haul to this address.
- **Hauling that follows your trucks.** Loads, store runs, shop trips, weekly diesel. Change the number of trucks and it re-plans.
- **Pallet deposits and tax scope.** Refundable deposits on their own line; tax on materials, hauling, and (optionally) deposits.
- **Quarry finder.** Federal mine records, sorted by distance.
- **Receipt scanning.** Photo in, price updates proposed, you approve.
- **Follow-up questions.** Tap-to-answer; the whole estimate re-runs with your answers.
- **Autosave, PDF, field-test log.**
- **Verification gates.** Deterministic checks on every generated estimate. Failures are shown, never hidden, and never block the estimate.

## Stack

| Layer | Tool |
|---|---|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| Research | Anthropic API with web search and vision |
| Maps | Leaflet; Johnson County GIS; USGS National Map imagery and 3DEP elevation |
| Public data | US Census geocoder, OpenStreetMap Nominatim, EIA diesel prices, MSHA mine records |
| Database | Neon (serverless Postgres) + Drizzle ORM |
| Auth | Clerk |
| PDF | jsPDF + jspdf-autotable |

## Running it yourself

You'll need free accounts on three services. Total cost to try it is a few cents of Anthropic usage.

### 1. Clone and install

```bash
git clone https://github.com/jesse-hendershot/LandscapeEstimate.git
cd LandscapeEstimate
npm install
```

### 2. Get credentials

**Neon** — create a project at [neon.tech](https://neon.tech). Copy the pooled connection string from Connection Details (the host with `-pooler` in it).

**Clerk** — create an application at [dashboard.clerk.com](https://dashboard.clerk.com). Copy the publishable key and the secret key from API Keys.

**Anthropic** — create a key at [console.anthropic.com](https://console.anthropic.com). Set a spend limit under Billing while you're there.

### 3. Configure

```bash
cp .env.example .env.local
```

Fill in the four required values:

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk → API Keys |
| `CLERK_SECRET_KEY` | Clerk → API Keys |
| `ANTHROPIC_API_KEY` | Anthropic console |

`.env.local` is gitignored. Never commit it.

### 4. Create the schema

```bash
npm run db:migrate
```

### 5. Run

```bash
npm run dev
```

Open `http://localhost:3000`, create an account, and generate an estimate. A starter catalog of 25 common materials and two placeholder trucks seed automatically on your first run. Then:

1. **Settings** — shop address, your real trucks (capacity, mpg, cost per hour).
2. **Suppliers** — add where you buy, or find quarries near you.
3. **Materials** — link each material to its supplier, set substitute groups, correct prices (or scan a receipt).

## Optional keys and tuning

| Variable | Effect |
|---|---|
| `OPENROUTESERVICE_API_KEY` | Real truck-route road miles (free key at openrouteservice.org). Without it, miles are straight-line × 1.3 and marked approximate. |
| `EIA_API_KEY` | Diesel price from the EIA API (free key at eia.gov/opendata). Without it, the same number is read from EIA's public history page. |
| `ESTIMATE_MODEL` | Model for the main call. Defaults to the top tier. |
| `ESTIMATE_REPAIR_MODEL` | Model for the repair pass. Defaults to `ESTIMATE_MODEL`. |
| `ESTIMATE_SEARCH_FIRST` | Set to `false` to skip web search on the first pass. |
| `SCAN_MODEL` | Model for reading receipts. Defaults to `ESTIMATE_MODEL`. |

Every estimate run is logged to `estimate_runs` with gates tripped, catalog vs researched line counts, latency and token usage — so cost and quality are measurable rather than guessed at.

## Tests

```bash
npm test
```

118 tests: money and gates, earthwork conversions, the haul planner and substitute ranking (including the worked example from the first field feedback), public-data parsers against captured live responses, receipt matching, the correction diff, and the screen's live totals against the server's cents. No network or database needed. The same suite runs in GitHub Actions on every push.

## Status

Live at [landscape-estimate.vercel.app](https://landscape-estimate.vercel.app/). Field trial with a working contractor under way, fall 2026.

## About

Built by Jesse Hendershot, mechanical engineering student at the University of Iowa.
