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
npx drizzle-kit generate    # writes ./drizzle/0000_*.sql — read it
npx drizzle-kit migrate     # applies it
```

Read the generated SQL before applying. It's short, and it's the one moment
you'd catch a schema mistake cheaply.

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

## What still needs doing

**The UI hasn't been rebuilt yet.** `app/page.tsx` still works — the API returns
the same shape it always did — but there's no catalog screen. You can add and
price materials through the API, and the seeded catalog gets you running, but
your boss can't edit prices without one. That's the next build.

**`/api/refine` is still ungated.** It mutates line items with no validation,
which means an estimate can pass every gate and then be changed into one that
wouldn't. `lib/estimate/gates.ts` operates on exactly the `LineItem[]` shape
refine deals in, so it's the right guard to point at it.

**Nothing has run against a real job yet.** Everything is tested against
fixtures. Run five or six real past jobs where you know the true cost, and
compare. That's the only way to find out whether the quantity logic is right.

---

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
