# 🐟 Fish Shop Manager

A management system for a fish shop that takes **phone orders**, with
**delivery tracking** and **automatic SMS updates to customers**.

Built for speed at the counter: take an order while on the phone, returning
customers auto-fill from their phone number, and every status change can text
the customer automatically.

**Stack:** Vercel (hosting + serverless API) · Supabase (Postgres database) ·
Twilio (SMS) · Express + vanilla-JS UI, no build step.

## Features

- **Phone order intake** — type the caller's number; returning customers
  auto-fill their name and delivery address. Pick items from the product
  catalog (price fills in automatically) or add custom items.
- **Order workflow** — New → Confirmed → Preparing → Ready → Out for delivery →
  Delivered (or Picked up for pickup orders), with one-tap status buttons.
- **Delivery tracking** — a per-day delivery run sheet with addresses, time
  slots and statuses; a dashboard showing everything due today.
- **Customer texts (SMS)** — automatic, editable message templates for
  confirmed / ready / out-for-delivery / delivered / cancelled, plus one-off
  custom texts. Every message is recorded in a log.
- **Staff login** — the whole app sits behind a shared staff password
  (`STAFF_PASSWORD`), so it's safe to host on a public URL.
- **Customer book & product catalog** — searchable customers with order
  history and notes; fish prices per lb/kg/each, hide out-of-season items.

## Deploying (Vercel + Supabase)

1. **Supabase** — create a project. The database schema lives in
   [`db/schema.sql`](db/schema.sql) and is applied as a migration
   (`fish_shop_initial_schema`); it creates the tables, default SMS templates
   and a starter fish catalog.
2. **Vercel** — create a project from this GitHub repo. Framework preset
   **Other**, no build command needed.
3. In Vercel → **Settings → Environment Variables**, add:
   | Name | Value |
   |---|---|
   | `DATABASE_URL` | Supabase → **Connect** → Connection string → **Transaction pooler** URI (port 6543), with your database password filled in |
   | `STAFF_PASSWORD` | the password your staff will use to log in |
   | `TWILIO_ACCOUNT_SID` | *(optional, for real SMS)* |
   | `TWILIO_AUTH_TOKEN` | *(optional)* |
   | `TWILIO_FROM_NUMBER` | *(optional)* your Twilio phone number, e.g. `+15551234567` |
4. Deploy. Every push to the repo's production branch redeploys automatically.

Without the Twilio variables the app runs in **simulation mode**: texts are
recorded in the Messages screen but not actually sent, so you can try
everything safely before buying a Twilio number.

## Local development

```bash
npm install
cp .env.example .env    # fill in DATABASE_URL (any Postgres works locally)
npm run db:setup        # applies db/schema.sql (idempotent)
npm start               # http://localhost:3000
```

## Tests

```bash
npm test
```

End-to-end smoke test against a disposable Postgres database (set
`TEST_DATABASE_URL`; **its public schema is dropped each run**). Covers login,
order intake, customer dedup by phone, status flow, SMS logging, delivery
filters and validation. Skips cleanly when no test database is reachable.

## Architecture notes

- `api/index.js` — Vercel serverless entry; all `/api/*` routes are rewritten
  here (`vercel.json`) and handled by the Express app in `src/app.js`.
- `public/` — static single-page UI, served by Vercel's CDN directly.
- `server.js` — standalone server for local dev or self-hosting (same app).
- Database access uses a direct Postgres connection (`postgres` driver,
  pooler-safe settings). Supabase's PostgREST API is not used; RLS is enabled
  with no policies so the anon/authenticated API roles can't read shop data.
- Auth is a shared staff password → HMAC session cookie (HttpOnly, 30 days).
  Changing `STAFF_PASSWORD` invalidates all sessions.

## API overview

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login`, `/api/logout` | staff session |
| GET/POST | `/api/customers` | search / create customers |
| GET/PUT | `/api/customers/:id` | customer detail + order history / update |
| GET/POST | `/api/products` | catalog (`?all=1` includes hidden) / create |
| PUT | `/api/products/:id` | update / hide product |
| GET/POST | `/api/orders` | list with filters (`status`, `type`, `date`, `q`) / create |
| GET/PUT | `/api/orders/:id` | order detail + texts / edit |
| POST | `/api/orders/:id/status` | move status, optionally texting the customer |
| GET | `/api/messages` | SMS log |
| POST | `/api/messages/send` | send a one-off text |
| GET/PUT | `/api/settings` | shop name, auto-SMS toggle, message templates |
| GET | `/api/dashboard` | today's counts and due orders |
