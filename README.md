# 🐟 Fish Shop Manager

A management system for a UK fish shop that takes **phone orders**, with
**delivery tracking** and **automatic SMS updates to customers**.
Prices in £, metric units, UK date formats.

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
- **Staff accounts** — individual username/password logins. The first visit
  to a fresh deployment sets up the first account; more staff can be added,
  removed, or have passwords reset in Settings. Passwords are stored hashed
  (scrypt); sessions are signed HttpOnly cookies (30 days).
- **Customer book & product catalog** — searchable customers with order
  history and notes; fish prices per kg/each, hide out-of-season items.

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
   | `TWILIO_ACCOUNT_SID` | *(optional, for real SMS)* |
   | `TWILIO_AUTH_TOKEN` | *(optional)* |
   | `TWILIO_FROM_NUMBER` | *(optional)* your Twilio phone number, e.g. `+447700900123` |
4. Deploy, then **open the app URL straight away** — the first visit shows a
   one-time setup screen that creates the first staff account.
   Every push to the repo's production branch redeploys automatically.

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
- Auth: staff accounts in the `users` table (scrypt password hashes). Session
  cookies are HMAC-signed with a random secret generated once and stored in
  the `settings` table — no secret env var needed. `/api/setup` only works
  while the users table is empty.

## API overview

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/me` | session status / first-run detection |
| POST | `/api/setup` | create the first account (fresh install only) |
| POST | `/api/login`, `/api/logout` | staff session |
| GET/POST | `/api/users` | staff accounts list / add |
| PUT/DELETE | `/api/users/:id` | rename, change password / remove |
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
