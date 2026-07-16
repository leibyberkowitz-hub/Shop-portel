/* End-to-end smoke test: boots the server against a disposable Postgres
   database and walks through the main flows — login, products, customers,
   order intake, status updates with SMS logging, deliveries and settings.

   Needs a throwaway database: set TEST_DATABASE_URL (its public schema is
   DROPPED each run). Skips cleanly when no test database is reachable.
   Run with: npm test */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const postgres = require('postgres');

const PORT = 3999;
const BASE = `http://localhost:${PORT}/api`;
const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/fishshop_test';

let cookie = '';

async function api(pathname, options = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

async function waitForServer(tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${BASE}/settings`);
      if (res.status === 200 || res.status === 401) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not start');
}

async function prepareDatabase() {
  const sql = postgres(DB_URL, { max: 1, connect_timeout: 5 });
  try {
    await sql`SELECT 1`;
  } catch (err) {
    await sql.end().catch(() => {});
    console.log(`SKIPPED: no test database reachable at ${DB_URL} (${err.message})`);
    console.log('Set TEST_DATABASE_URL to a disposable Postgres database to run the smoke test.');
    process.exit(0);
  }
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await sql.unsafe(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  await sql.end();
}

async function run() {
  // --- first-run setup ---
  let res = await api('/auth/me');
  assert.equal(res.data.setup_required, true, 'fresh database requires setup');
  res = await api('/settings');
  assert.equal(res.status, 401, 'API requires login');
  res = await api('/setup', { method: 'POST', body: { name: 'Leiby', username: 'leiby', password: '12345' } });
  assert.equal(res.status, 400, 'short password rejected');
  res = await api('/setup', { method: 'POST', body: { name: 'Leiby', username: 'Leiby', password: 'gefilte123' } });
  assert.equal(res.status, 201);
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('shop_session='), 'setup sets session cookie');
  res = await api('/setup', { method: 'POST', body: { name: 'X', username: 'x2', password: 'hijack123' } });
  assert.equal(res.status, 403, 'setup only works once');

  // --- login ---
  cookie = '';
  res = await api('/login', { method: 'POST', body: { username: 'leiby', password: 'wrong' } });
  assert.equal(res.status, 401, 'wrong password rejected');
  res = await api('/login', { method: 'POST', body: { username: 'LEIBY', password: 'gefilte123' } });
  assert.equal(res.status, 200, 'username is case-insensitive');
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  res = await api('/auth/me');
  assert.equal(res.data.authenticated, true);
  assert.equal(res.data.user.name, 'Leiby');

  // --- staff management ---
  res = await api('/users', { method: 'POST', body: { name: 'Dovid', username: 'dovid', password: 'herring99' } });
  assert.equal(res.status, 201);
  const dovid = res.data;
  res = await api('/users', { method: 'POST', body: { name: 'Dup', username: 'dovid', password: 'other123' } });
  assert.equal(res.status, 409, 'duplicate username rejected');
  res = await api(`/users/${dovid.id}`, { method: 'PUT', body: { password: 'newpass77' } });
  assert.equal(res.status, 200);
  const meId = (await api('/auth/me')).data.user.id;
  res = await api(`/users/${meId}`, { method: 'DELETE' });
  assert.equal(res.status, 400, 'cannot delete own account');
  res = await api(`/users/${dovid.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal((await api('/users')).data.length, 1);

  // --- settings (UK defaults) ---
  const settings = (await api('/settings')).data;
  assert.equal(settings.twilio_configured, false, 'test runs in simulation mode');
  assert.equal(settings.session_secret, undefined, 'session secret never leaves the server');
  assert.ok(settings.sms_confirmed.includes('{order}'));
  assert.ok(settings.sms_confirmed.includes('£{total}'), 'templates use pounds');

  // --- products (seeded by schema.sql) ---
  const seeded = (await api('/products')).data;
  assert.ok(seeded.length >= 10, 'starter catalog seeded');
  assert.equal(typeof seeded[0].price, 'number', 'numeric comes back as JS number');
  res = await api('/products', { method: 'POST', body: { name: 'Test mackerel', unit: 'kg', price: 5.5 } });
  assert.equal(res.status, 201);
  const salmon = seeded.find((p) => p.name === 'Salmon fillet');
  assert.equal(salmon.unit, 'kg', 'catalog is metric');

  // --- customer created implicitly through order intake ---
  res = await api('/orders', {
    method: 'POST',
    body: {
      customer_name: 'Sarah Cohen',
      customer_phone: '(555) 123-4567',
      type: 'delivery',
      due_date: '2099-01-01',
      time_slot: '2-4pm',
      address: '12 Main St',
      items: [
        { product_id: salmon.id, name: 'Salmon fillet', quantity: 2, unit: 'kg', unit_price: 14.99 },
        { name: 'Custom smoked trout', quantity: 1, unit: 'each', unit_price: 9.5 },
      ],
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const order = res.data;
  assert.equal(order.total, 39.48);
  assert.equal(order.customer_phone, '5551234567', 'phone is normalized');
  assert.equal(order.items.length, 2);

  // Same phone → same customer, no duplicate.
  res = await api('/orders', {
    method: 'POST',
    body: {
      customer_name: 'Sarah Cohen',
      customer_phone: '555-123-4567',
      type: 'pickup',
      items: [{ name: 'Herring', quantity: 1, unit: 'each', unit_price: 6.49 }],
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.customer_id, order.customer_id);

  // --- validation ---
  res = await api('/orders', { method: 'POST', body: { customer_name: 'X', customer_phone: '5550001111', items: [] } });
  assert.equal(res.status, 400, 'empty order rejected');
  res = await api(`/orders/${order.id}/status`, { method: 'POST', body: { status: 'flying' } });
  assert.equal(res.status, 400, 'bad status rejected');

  // --- status flow with SMS ---
  res = await api(`/orders/${order.id}/status`, { method: 'POST', body: { status: 'confirmed', send_sms: true } });
  assert.equal(res.status, 200);
  assert.equal(res.data.order.status, 'confirmed');
  assert.equal(res.data.sms.status, 'simulated');

  res = await api(`/orders/${order.id}/status`, { method: 'POST', body: { status: 'out_for_delivery', send_sms: true } });
  assert.equal(res.data.sms.status, 'simulated');

  res = await api(`/orders/${order.id}/status`, { method: 'POST', body: { status: 'delivered', send_sms: false } });
  assert.equal(res.data.sms, null, 'no SMS when unchecked');

  const detail = (await api(`/orders/${order.id}`)).data;
  assert.equal(detail.messages.length, 2);
  assert.ok(detail.messages.some((m) => m.body.includes(`#${order.id}`)));
  assert.ok(detail.messages.some((m) => m.body.toLowerCase().includes('out for delivery')));

  // --- manual text ---
  res = await api('/messages/send', {
    method: 'POST',
    body: { customer_id: order.customer_id, body: 'Your carp came in today!' },
  });
  assert.equal(res.status, 200);
  const log = (await api('/messages')).data;
  assert.equal(log.length, 3);

  // --- deliveries & filters ---
  const deliveries = (await api('/orders?type=delivery&date=2099-01-01')).data;
  assert.equal(deliveries.length, 1);
  const open = (await api('/orders?status=open')).data;
  assert.equal(open.length, 1, 'only the pickup order is still open');
  const search = (await api('/orders?q=Sarah')).data;
  assert.equal(search.length, 2);

  // --- customers ---
  const customers = (await api('/customers?q=555')).data;
  assert.equal(customers.length, 1);
  res = await api('/customers', { method: 'POST', body: { name: 'Dup', phone: '555 123 4567' } });
  assert.equal(res.status, 409, 'duplicate phone rejected');

  // --- settings update ---
  res = await api('/settings', { method: 'PUT', body: { shop_name: "Berko's Fish", auto_sms: '0' } });
  assert.equal(res.data.shop_name, "Berko's Fish");

  // --- dashboard ---
  const dash = (await api('/dashboard')).data;
  assert.equal(dash.counts.open_orders, 1);

  console.log('All smoke tests passed ✅');
}

let server;
prepareDatabase()
  .then(() => {
    server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: {
        ...process.env,
        PORT: String(PORT),
        DATABASE_URL: DB_URL,
        TWILIO_ACCOUNT_SID: '',
        TWILIO_AUTH_TOKEN: '',
        TWILIO_FROM_NUMBER: '',
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    return waitForServer();
  })
  .then(run)
  .then(() => {
    server.kill();
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    if (server) server.kill();
    process.exit(1);
  });
