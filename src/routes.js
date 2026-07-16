const express = require('express');
const { sql, getSettings, setSettings } = require('./db');
const { sendSms, messageForStatus, twilioConfigured } = require('./sms');
const { authEnabled } = require('./auth');

const router = express.Router();

const ORDER_STATUSES = [
  'new',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'picked_up',
  'cancelled',
];

const TS = (col) => sql.unsafe(`to_char(${col}, 'YYYY-MM-DD HH24:MI') AS ${col.split('.').pop()}`);

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}

function idParam(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

const UNIQUE_VIOLATION = '23505';

// ---------- Customers ----------

router.get('/customers', async (req, res) => {
  const q = (req.query.q || '').trim();
  const like = `%${q}%`;
  const rows = q
    ? await sql`
        SELECT *, ${TS('created_at')} FROM customers
        WHERE name ILIKE ${like} OR phone LIKE ${like} OR address ILIKE ${like}
        ORDER BY name LIMIT 200`
    : await sql`SELECT *, ${TS('created_at')} FROM customers ORDER BY name LIMIT 500`;
  res.json(rows);
});

router.get('/customers/:id', async (req, res) => {
  const id = idParam(req);
  const [customer] = id ? await sql`SELECT * FROM customers WHERE id = ${id}` : [];
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  customer.orders = await sql`
    SELECT *, ${TS('orders.created_at')} FROM orders
    WHERE customer_id = ${id} ORDER BY orders.created_at DESC LIMIT 50`;
  res.json(customer);
});

router.post('/customers', async (req, res) => {
  const { name, phone, address = '', notes = '' } = req.body || {};
  if (!name || !phone) return badRequest(res, 'Name and phone are required');
  const normalized = normalizePhone(phone);
  if (!normalized) return badRequest(res, 'Phone number is invalid');
  try {
    const [row] = await sql`
      INSERT INTO customers (name, phone, address, notes)
      VALUES (${name.trim()}, ${normalized}, ${address.trim()}, ${notes.trim()})
      RETURNING *`;
    res.status(201).json(row);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ error: 'A customer with this phone number already exists' });
    }
    throw err;
  }
});

router.put('/customers/:id', async (req, res) => {
  const id = idParam(req);
  const [customer] = id ? await sql`SELECT * FROM customers WHERE id = ${id}` : [];
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const { name, phone, address, notes } = req.body || {};
  const normalized = phone !== undefined ? normalizePhone(phone) : customer.phone;
  if (!normalized) return badRequest(res, 'Phone number is invalid');
  try {
    const [row] = await sql`
      UPDATE customers SET
        name = ${(name ?? customer.name).trim()},
        phone = ${normalized},
        address = ${(address ?? customer.address).trim()},
        notes = ${(notes ?? customer.notes).trim()}
      WHERE id = ${id} RETURNING *`;
    res.json(row);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ error: 'A customer with this phone number already exists' });
    }
    throw err;
  }
});

// ---------- Products ----------

router.get('/products', async (req, res) => {
  const rows =
    req.query.all === '1'
      ? await sql`SELECT * FROM products ORDER BY name`
      : await sql`SELECT * FROM products WHERE active ORDER BY name`;
  res.json(rows);
});

router.post('/products', async (req, res) => {
  const { name, unit = 'lb', price = 0 } = req.body || {};
  if (!name) return badRequest(res, 'Product name is required');
  const [row] = await sql`
    INSERT INTO products (name, unit, price)
    VALUES (${name.trim()}, ${unit}, ${Number(price) || 0}) RETURNING *`;
  res.status(201).json(row);
});

router.put('/products/:id', async (req, res) => {
  const id = idParam(req);
  const [product] = id ? await sql`SELECT * FROM products WHERE id = ${id}` : [];
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const { name, unit, price, active } = req.body || {};
  const [row] = await sql`
    UPDATE products SET
      name = ${(name ?? product.name).trim()},
      unit = ${unit ?? product.unit},
      price = ${price !== undefined ? Number(price) || 0 : product.price},
      active = ${active !== undefined ? Boolean(active) : product.active}
    WHERE id = ${id} RETURNING *`;
  res.json(row);
});

// ---------- Orders ----------

const ORDER_SELECT = () => sql`
  SELECT o.*, to_char(o.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
         c.name AS customer_name, c.phone AS customer_phone
  FROM orders o JOIN customers c ON c.id = o.customer_id`;

async function orderWithDetails(orderId) {
  const [order] = await sql`${ORDER_SELECT()} WHERE o.id = ${orderId}`;
  if (!order) return null;
  order.items = await sql`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY id`;
  return order;
}

router.get('/orders', async (req, res) => {
  const { status, type, date, q } = req.query;
  const like = `%${q || ''}%`;
  const rows = await sql`
    ${ORDER_SELECT()}
    WHERE TRUE
    ${
      status === 'open'
        ? sql`AND o.status NOT IN ('delivered', 'picked_up', 'cancelled')`
        : status
          ? sql`AND o.status = ${status}`
          : sql``
    }
    ${type ? sql`AND o.type = ${type}` : sql``}
    ${date ? sql`AND o.due_date = ${date}` : sql``}
    ${
      q
        ? sql`AND (c.name ILIKE ${like} OR c.phone LIKE ${like} OR o.id::text = ${String(q).replace('#', '')})`
        : sql``
    }
    ORDER BY o.created_at DESC LIMIT 300`;
  res.json(rows);
});

router.get('/orders/:id', async (req, res) => {
  const id = idParam(req);
  const order = id ? await orderWithDetails(id) : null;
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.messages = await sql`
    SELECT *, ${TS('messages.created_at')} FROM messages
    WHERE order_id = ${id} ORDER BY messages.created_at DESC, messages.id DESC`;
  res.json(order);
});

async function insertItems(sql, orderId, items) {
  let total = 0;
  for (const item of items) {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unit_price) || 0;
    const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
    total += lineTotal;
    await sql`
      INSERT INTO order_items (order_id, product_id, name, quantity, unit, unit_price, line_total)
      VALUES (${orderId}, ${item.product_id || null}, ${String(item.name || '').trim()},
              ${quantity}, ${item.unit || 'lb'}, ${unitPrice}, ${lineTotal})`;
  }
  return Math.round(total * 100) / 100;
}

router.post('/orders', async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items.filter((i) => i && i.name) : [];
  if (!items.length) return badRequest(res, 'Order needs at least one item');

  // Resolve the customer: use an existing id, or match by phone, or create one.
  let customerId = body.customer_id;
  if (!customerId) {
    const { customer_name: name, customer_phone: phone } = body;
    if (!name || !phone) return badRequest(res, 'Customer name and phone are required');
    const normalized = normalizePhone(phone);
    if (!normalized) return badRequest(res, 'Phone number is invalid');
    const [existing] = await sql`SELECT * FROM customers WHERE phone = ${normalized}`;
    if (existing) {
      customerId = existing.id;
      if (body.type === 'delivery' && (body.address || '').trim() && !existing.address) {
        await sql`UPDATE customers SET address = ${body.address.trim()} WHERE id = ${existing.id}`;
      }
    } else {
      const [created] = await sql`
        INSERT INTO customers (name, phone, address)
        VALUES (${name.trim()}, ${normalized}, ${(body.address || '').trim()})
        RETURNING id`;
      customerId = created.id;
    }
  } else {
    const [exists] = await sql`SELECT id FROM customers WHERE id = ${customerId}`;
    if (!exists) return badRequest(res, 'Customer not found');
  }

  // Delivery orders fall back to the customer's saved address.
  if (body.type === 'delivery' && !(body.address || '').trim()) {
    const [customer] = await sql`SELECT address FROM customers WHERE id = ${customerId}`;
    body.address = customer.address || '';
    if (!body.address) return badRequest(res, 'Delivery orders need an address');
  }

  const orderId = await sql.begin(async (sql) => {
    const [order] = await sql`
      INSERT INTO orders (customer_id, type, due_date, time_slot, address, notes)
      VALUES (${customerId}, ${body.type || 'pickup'}, ${body.due_date || ''},
              ${body.time_slot || ''}, ${(body.address || '').trim()}, ${(body.notes || '').trim()})
      RETURNING id`;
    const total = await insertItems(sql, order.id, items);
    await sql`UPDATE orders SET total = ${total} WHERE id = ${order.id}`;
    return order.id;
  });
  res.status(201).json(await orderWithDetails(orderId));
});

router.put('/orders/:id', async (req, res) => {
  const id = idParam(req);
  const [order] = id ? await sql`SELECT * FROM orders WHERE id = ${id}` : [];
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items.filter((i) => i && i.name) : null;
  if (items && !items.length) return badRequest(res, 'Order needs at least one item');

  await sql.begin(async (sql) => {
    let total = order.total;
    if (items) {
      await sql`DELETE FROM order_items WHERE order_id = ${id}`;
      total = await insertItems(sql, id, items);
    }
    await sql`
      UPDATE orders SET
        type = ${body.type ?? order.type},
        due_date = ${body.due_date ?? order.due_date},
        time_slot = ${body.time_slot ?? order.time_slot},
        address = ${(body.address ?? order.address).trim()},
        notes = ${(body.notes ?? order.notes).trim()},
        total = ${total},
        updated_at = now()
      WHERE id = ${id}`;
  });
  res.json(await orderWithDetails(id));
});

router.post('/orders/:id/status', async (req, res) => {
  const id = idParam(req);
  const [order] = id ? await sql`SELECT * FROM orders WHERE id = ${id}` : [];
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const { status, send_sms } = req.body || {};
  if (!ORDER_STATUSES.includes(status)) return badRequest(res, 'Invalid status');

  await sql`UPDATE orders SET status = ${status}, updated_at = now() WHERE id = ${id}`;

  const updated = await orderWithDetails(id);
  const settings = await getSettings();
  const shouldSend = send_sms !== undefined ? Boolean(send_sms) : settings.auto_sms === '1';
  let sms = null;
  if (shouldSend) {
    const [customer] = await sql`SELECT * FROM customers WHERE id = ${order.customer_id}`;
    const body = messageForStatus(updated, customer, settings);
    if (body) {
      sms = await sendSms({ phone: customer.phone, body, customerId: customer.id, orderId: id });
    }
  }
  res.json({ order: updated, sms });
});

// ---------- Messages ----------

router.get('/messages', async (req, res) => {
  const rows = await sql`
    SELECT m.*, to_char(m.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
           c.name AS customer_name
    FROM messages m LEFT JOIN customers c ON c.id = m.customer_id
    ORDER BY m.created_at DESC, m.id DESC LIMIT 200`;
  res.json(rows);
});

router.post('/messages/send', async (req, res) => {
  const { customer_id, order_id = null, body } = req.body || {};
  if (!body || !String(body).trim()) return badRequest(res, 'Message body is required');
  const [customer] = customer_id
    ? await sql`SELECT * FROM customers WHERE id = ${customer_id}`
    : [];
  if (!customer) return badRequest(res, 'Customer not found');
  const result = await sendSms({
    phone: customer.phone,
    body: String(body).trim(),
    customerId: customer.id,
    orderId: order_id,
  });
  res.status(result.ok ? 200 : 502).json(result);
});

// ---------- Settings & dashboard ----------

async function settingsResponse() {
  return {
    ...(await getSettings()),
    twilio_configured: twilioConfigured(),
    auth_enabled: authEnabled(),
  };
}

router.get('/settings', async (req, res) => {
  res.json(await settingsResponse());
});

router.put('/settings', async (req, res) => {
  const allowed = [
    'shop_name',
    'auto_sms',
    'sms_confirmed',
    'sms_ready',
    'sms_out_for_delivery',
    'sms_delivered',
    'sms_cancelled',
  ];
  const patch = {};
  for (const key of allowed) {
    if (req.body && req.body[key] !== undefined) patch[key] = req.body[key];
  }
  await setSettings(patch);
  res.json(await settingsResponse());
});

router.get('/dashboard', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const [counts] = await sql`
    SELECT
      count(*) FILTER (WHERE status NOT IN ('delivered', 'picked_up', 'cancelled'))::int AS open_orders,
      count(*) FILTER (WHERE status = 'new')::int AS new_orders,
      count(*) FILTER (WHERE type = 'delivery' AND due_date = ${today}
                       AND status NOT IN ('delivered', 'cancelled'))::int AS deliveries_today,
      count(*) FILTER (WHERE status = 'out_for_delivery')::int AS out_for_delivery
    FROM orders`;
  const todayOrders = await sql`
    ${ORDER_SELECT()}
    WHERE o.due_date = ${today} OR (o.due_date = '' AND o.created_at::date = ${today}::date)
    ORDER BY (o.status = 'new') DESC, o.time_slot, o.created_at`;
  res.json({ today, counts, todayOrders });
});

module.exports = router;
