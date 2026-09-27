# Getting this deployed

Two accounts to create — I can't make them for you. Both free at your volume.
Budget about 30 minutes end to end.

---

## 1. Install the new dependencies

```bash
npm install drizzle-orm @neondatabase/serverless @clerk/nextjs zod
npm install -D drizzle-kit tsx
```

## 2. Neon (the database)

1. Sign up at **neon.tech** → create a project. Region: **AWS us-east-2** or
   **us-east-1**, whichever Vercel region you deploy to. Same region matters —
   cross-region adds 60–80ms to every query.
2. From the dashboard, copy the **pooled** connection string. It has `-pooler`
   in the hostname. The non-pooled one will work locally and then exhaust
   connections the first time two people use the app at once.

## 3. Clerk (the logins)

1. Sign up at **clerk.com** → create an application.
2. Enable **Email** and, if your boss would rather not manage another password,
   **Google**. Turn off anything you don't want.
3. Copy the publishable key and the secret key from **API Keys**.
4. Under **Restrictions**, turn on **Allowlist** and add only the email
   addresses that should have accounts. Otherwise anyone who finds the URL can
   sign up and start burning your Anthropic credits.

## 4. Environment

Add to `.env.local` (keep your existing `ANTHROPIC_API_KEY` line):

```
DATABASE_URL=postgresql://...-pooler...neon.tech/neondb?sslmode=require

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

`.env.local` is already gitignored. Check that before your first commit anyway.

## 5. Create the tables

```bash
npm run db:migrate
```

This applies every file in `./drizzle` in order. Read the SQL first — it's
short, and it's the one moment you'd catch a schema mistake cheaply.

### Upgrading a running deployment

Run the migration against the production database **before** the new code
deploys. Migrations here only ever add tables and columns, so the old code keeps
working against the new schema; the new code does not work against the old one.

```bash
DATABASE_URL="<production pooled string>" npm run db:migrate
```

## 6. Run it

```bash
npm run dev
```

Sign up with your own email. On first load the app seeds your catalog with ~25
Iowa landscaping materials.

**Then do the thing that actually matters:** go through those materials and
replace my prices with yours. Every one you correct is a line that stops being a
guess. The ones you don't stock, delete.

## 7. Deploy

```bash
npx vercel
```

Then in the Vercel dashboard, add all five environment variables from step 4
plus `ANTHROPIC_API_KEY` under **Settings → Environment Variables**, for
Production. Redeploy after adding them — Vercel doesn't pick up new env vars on
an existing build.

Send your boss the URL. He signs up with the email you allowlisted.

---

## What it costs

- **Neon** — free tier covers this comfortably. 0.5 GB storage; you'd need tens
  of thousands of estimates to approach it.
- **Clerk** — free to 10,000 monthly active users.
- **Vercel** — free Hobby tier works. Note Hobby is for non-commercial use; if
  the shop is running quotes off it, that's Pro at $20/month.
- **Anthropic** — the real cost. Each estimate is one Opus call with web search,
  plus a second call only when a gate fails. Rough order of magnitude is cents
  per estimate, but check your actual usage after the first week rather than
  trusting my estimate.

---

## First things to set up in the app

1. **Settings** — the shop address (every job adds a round trip from here per
   truck), and your real trucks: what each carries in tons and cubic yards, its
   mpg, and what an hour of truck + driver costs you, not counting fuel.
2. **Suppliers** — the places you buy from, with addresses. The quarry finder
   lists every active quarry and gravel pit near you from federal records.
3. **Materials** — link each material to its supplier (the ⋯ button opens the
   rest: substitute group, weight per yard, pallet size and deposit). Materials
   in the same substitute group can stand in for each other; estimates pick the
   cheapest one delivered to the job.

Two optional free keys make distances and diesel sharper — see the README's
"Optional keys and tuning". Add them in Vercel's environment variables.

## What still needs doing

**Parcel data is Johnson County only.** Linn County's public parcel service
wasn't reachable when this was built; outside Johnson County the map still has
aerials and measuring, just no lot lines. Adding a county is one entry in
`lib/site/sources.ts`.

**Nothing learns from the correction log yet.** Every edit to a generated
estimate is recorded in `line_edits`. That's the training data; the model that
uses it is a later build.

## Notes on a couple of decisions

**Money is integer cents everywhere.** No floats in the database, none in any
arithmetic. `lib/money.ts` converts at the edges and nowhere else.

**The model never sees catalog prices and never does arithmetic.** It returns
catalog ids and quantities; the server applies your prices and computes
delivery, tax and the total. A price the model can't see is a price it can't get
wrong, and three of the original eight checklist items no longer describe
anything that can happen.

**Catalog prices are never bounds-checked.** If you pay $99/yd for mulch, that's
your business. Only researched prices on off-catalog items get range-checked.

**Deleting a material deactivates it rather than removing it,** so past
estimates keep the provenance of their own lines.
