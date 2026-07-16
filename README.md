# 🐟 Fish Shop Manager

A simple, self-hosted system for a fish shop that takes **phone orders**, with
**delivery tracking** and **automatic SMS updates to customers**.

Built for speed at the counter: take an order while on the phone, returning
customers auto-fill from their phone number, and every status change can text
the customer automatically.

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
- **Customer book** — searchable customers with order history and notes
  (e.g. "always wants fish filleted, no skin").
- **Product catalog** — fish and prices per lb/kg/each, hide items that are
  out of season.

## Quick start

```bash
npm install
npm run seed     # optional: load a starter catalog of common fish
npm start        # http://localhost:3000
```

Requires Node.js 18+. Data is stored in a local SQLite file (`data/shop.db`)
— no external database needed. Back up the shop by copying the `data/` folder.

## Sending real texts (Twilio)

Out of the box the app runs in **simulation mode**: texts are recorded in the
Messages screen but not actually sent, so you can try everything safely.

To send real SMS, create a [Twilio](https://www.twilio.com) account, buy a
phone number, then copy `.env.example` to `.env` and fill in:

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+15551234567
```

Restart the server — the Settings screen will show "Twilio is configured" and
statuses updates will text customers for real. Message templates (and the shop
name used in them) are editable in **Settings**.

## Tests

```bash
npm test
```

Runs an end-to-end smoke test against a temporary database: order intake,
customer dedup by phone, status flow, SMS logging, delivery filters and
validation.

## Tech

Node.js + Express + SQLite (`better-sqlite3`), vanilla-JS single-page UI —
no build step, one process, runs on any small server or a shop PC.

## API overview

| Method | Path | Purpose |
|---|---|---|
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
