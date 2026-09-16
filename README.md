# LandscapeEstimate

A materials cost estimator for landscape contractors. Type in what a job needs, get live pricing back, and apply markup to produce a quote total.

## Why I built it

I've worked at a landscape contracting company since 2022. Quotes there get built by hand — an estimator looks up material prices one item at a time, adds margin on paper, and writes a number down. It's slow, it's inconsistent between jobs, and the prices are usually whatever was true the last time somebody checked. That produces estimates that are either inflated or leave money on the table.

This collapses that into a single entry field.

## Features

- **Free-text material entry** — type in any material instead of picking from a fixed catalog
- **Live price retrieval** — pulls current pricing rather than relying on a stale list
- **Markup calculator** — applies configurable margin and generates a customer-facing quote total
- **Saved material lists** — each account keeps its most commonly used materials for faster repeat estimates

## Stack

| Layer | Tool |
|---|---|
| Framework | Next.js |
| Language | TypeScript |
| Pricing | Anthropic API |
| Database | Neon (serverless Postgres) |
| Auth | Clerk |

## Running locally

```bash
git clone https://github.com/jesse-hendershot/LandscapeEstimate.git
cd LandscapeEstimate
npm install
npm run dev
```

Then open `http://localhost:3000`.

You'll need your own credentials. Copy `.env.example` to `.env.local` and fill in:

```
ANTHROPIC_API_KEY=
DATABASE_URL=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
```

## Status

Running locally. Field trial with a working contractor planned for Fall 2026.

On the roadmap:
- Aggressive caching on price lookups to cut API cost
- A demo mode that runs off a static price set, so the app is usable without credentials
- Deployment

## Screenshots

<!-- Add 2-3 here: the input screen, a returned estimate, and the markup view. -->

## About

Built by Jesse Hendershot, mechanical engineering student at the University of Iowa.
