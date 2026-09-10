# Yoga Booking — Vercel + Neon

A class-booking app: students book classes, instructors see rosters, the owner manages the schedule. This is the **Vercel + Neon (Postgres)** build — the browser-first deploy target. (A Cloudflare Workers + D1 version of the same app exists separately.)

## Deploy it yourself (one click)

> **Phase 1 note:** the button below is the *shape* of the finished flow. The pre-wired Neon integration is wired up in Phase 3. For now, deploy and provision the database manually per "Manual first deploy" below.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=REPLACE_WITH_REPO_URL)

When the integration is live, clicking Deploy will: create the project on **your** Vercel account, prompt you to add a **Neon** Postgres database (provisioned on your account, connection string injected automatically), build, and hand you a live URL. No terminal, no local setup.

## What you end up owning

- The **source** — in your GitHub.
- The **hosting** — a Vercel project on your account.
- The **database** — a Neon Postgres instance on your account, dedicated to this app.

## Manual first deploy (Phase 1 validation)

1. Create a Neon project → copy its connection string.
2. Locally: `export DATABASE_URL="…"` then `npm install && npm run seed` to create the schema and demo data.
3. Import this repo into Vercel, set `DATABASE_URL` as an environment variable, and deploy.
4. The app also self-migrates on first request (idempotent), so the schema is created even if you skip the seed step — but seeding gives you demo classes and users to click.

## How it works

- One serverless function (`api/index.ts`) serves the UI and the JSON routes.
- Access control lives in `lib/guards.ts`: roles → permissions → screens, plus the booking guards (permission → double-book → capacity).
- The schema (`lib/schema.sql`) runs on cold start, guarded so re-runs are a no-op.
