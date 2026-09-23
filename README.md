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

The shop keeps a **catalog** — the twenty-odd things it buys every week, at its real prices. The model never sees a catalog price and never supplies one. It reads the job, picks materials, and returns a catalog id and a quantity; the server applies the price.

That has two consequences worth stating plainly:

- **A catalog line cannot have a wrong price.** A wrong price is wrong in exactly one place, where one person fixes it once for every future job.
- **The model does no arithmetic.** Delivery, tax, subtotal and grand total are all computed in TypeScript. Money is integer cents everywhere; no float touches a number a contractor reads.

Anything off-catalog — a specific plant, an odd block — gets researched with web search, and those lines are flagged with their source so you can see which numbers are solid and which are estimates.

## Features

- **Plain-English job entry.** No forms, no dropdowns, no picking from a list.
- **Per-account catalog.** Your prices, used exactly as written.
- **Clarifying questions.** If the job is underspecified the model says so instead of guessing — a retaining wall with no stated height comes back with questions, not an invented block count.
- **Markup calculator.** Slide from 10% to 150% and see materials cost, your margin, and the customer-facing number.
- **PDF export.** Customer-ready quote.
- **Verification gates.** Every generated estimate runs a deterministic gate stack before it reaches you — unit mismatches, duplicate materials, bad sources, out-of-band prices. Failures are shown, never hidden, and never block the estimate.

## Stack

| Layer | Tool |
|---|---|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| Research | Anthropic API with web search |
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
npx drizzle-kit push
```

### 5. Run

```bash
npm run dev
```

Open `http://localhost:3000`, create an account, and generate an estimate. A starter catalog of 25 common materials seeds automatically on your first run — edit it under **Materials** to match what you actually pay.

## Optional tuning

These control cost and are all optional:

| Variable | Effect |
|---|---|
| `ESTIMATE_MODEL` | Model for the main call. Defaults to the top tier. |
| `ESTIMATE_REPAIR_MODEL` | Model for the repair pass. Defaults to `ESTIMATE_MODEL`. |
| `ESTIMATE_SEARCH_FIRST` | Set to `false` to skip web search on the first pass. Catalog-only jobs need no research; the repair pass still enables search when the sources gate fails. |

Every estimate run is logged to `estimate_runs` with gates tripped, catalog vs researched line counts, latency and token usage — so cost and quality are measurable rather than guessed at.

## Tests

```bash
npx tsx --test lib/estimate/gates.test.ts
```

26 tests covering the gate stack against fixtures.

## Status

Running locally. Field trial with a working contractor planned for Fall 2026.

## About

Built by Jesse Hendershot, mechanical engineering student at the University of Iowa.
