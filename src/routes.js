const express = require('express');
const { db, getSettings, setSettings } = require('./db');
const { sendSms, messageForStatus, twilioConfigured } = require('./sms');

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

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

// ---------- Customers ----------

router.get('/customers', (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db
      .prepare(
        `SELECT * FROM customers
         WHERE name LIKE ? OR phone LIKE ? OR address LIKE ?
         ORDER BY name COLLATE NOCASE LIMIT 200`
      )
      .all(like, like, like);
  } else {
    rows = db.prepare('SELECT * FROM customers ORDER BY name COLLATE NOCASE LIMIT 500').all();
  }
  res.json(rows);
});

router.get('/customers/:id', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const orders = db
    .prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(customer.id);
  res.json({ ...customer, orders });
});

router.post('/customers', (req, res) => {
  const { name, phone, address = '', notes = '' } = req.body || {};
  if (!name || !phone) return badRequest(res, 'Name and phone are required');
  const normalized = normalizePhone(phone);
  if (!normalized) return badRequest(res, 'Phone number is invalid');
  try {
    const info = db
      .prepare('INSERT INTO customers (name, phone, address, notes) VALUES (?, ?, ?, ?)')
      .run(name.trim(), normalized, address.trim(), notes.trim());
    res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A customer with this phone number already exists' });
    }
    throw err;
  }
});

router.put('/customers/:id', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const { name, phone, address, notes } = req.body || {};
  const normalized = phone !== undefined ? normalizePhone(phone) : customer.phone;
  if (!normalized) return badRequest(res, 'Phone number is invalid');
  try {
    db.prepare('UPDATE customers SET name = ?, phone = ?, address = ?, notes = ? WHERE id = ?').run(
      (name ?? customer.name).trim(),
      normalized,
      (address ?? customer.address).trim(),
      (notes ?? customer.notes).trim(),
      customer.id
    );
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A customer with this phone number already exists' });
    }
    throw err;
  }
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id));
});

// ---------- Products ----------

router.get('/products', (req, res) => {
  const includeInactive = req.query.all === '1';
  const rows = includeInactive
    ? db.prepare('SELECT * FROM products ORDER BY name COLLATE NOCASE').all()
    : db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY name COLLATE NOCASE').all();
  res.json(rows);
});

router.post('/products', (req, res) => {
  const { name, unit = 'lb', price = 0 } = req.body || {};
  if (!name) return badRequest(res, 'Product name is required');
  const info = db
    .prepare('INSERT INTO products (name, unit, price) VALUES (?, ?, ?)')
    .run(name.trim(), unit, Number(price) || 0);
  res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const { name, unit, price, active } = req.body || {};
  db.prepare('UPDATE products SET name = ?, unit = ?, price = ?, active = ? WHERE id = ?').run(
    (name ?? product.name).trim(),
    unit ?? product.unit,
    price !== undefined ? Number(price) || 0 : product.price,
    active !== undefined ? (active ? 1 : 0) : product.active,
    product.id
  );
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(product.id));
});

// ---------- Orders ----------

function orderWithDetails(orderId) {
  const order = db
    .prepare(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`
    )
    .get(orderId);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  return order;
}

router.get('/orders', (req, res) => {
  const clauses = [];
  const params = [];
  const { status, type, date, q } = req.query;
  if (status) {
    if (status === 'open') {
      clauses.push("o.status NOT IN ('delivered', 'picked_up', 'cancelled')");
    } else {
      clauses.push('o.status = ?');
      params.push(status);
    }
  }
  if (type) {
    clauses.push('o.type = ?');
    params.push(type);
  }
  if (date) {
    clauses.push('o.due_date = ?');
    params.push(date);
  }
  if (q) {
    clauses.push('(c.name LIKE ? OR c.phone LIKE ? OR CAST(o.id AS TEXT) = ?)');
    params.push(`%${q}%`, `%${q}%`, String(q).replace('#', ''));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
       FROM orders o JOIN customers c ON c.id = o.customer_id
       ${where}
       ORDER BY o.created_at DESC LIMIT 300`
    )
    .all(...params);
  res.json(rows);
});

router.get('/orders/:id', (req, res) => {
  const order = orderWithDetails(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.messages = db
    .prepare('SELECT * FROM messages WHERE order_id = ? ORDER BY created_at DESC')
    .all(order.id);
  res.json(order);
});

const createOrderTx = db.transaction((customerId, body) => {
  const { type = 'pickup', due_date = '', time_slot = '', address = '', notes = '', items = [] } = body;
  const info = db
    .prepare(
      `INSERT INTO orders (customer_id, type, due_date, time_slot, address, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(customerId, type, due_date, time_slot, address.trim(), notes.trim());
  const orderId = info.lastInsertRowid;
  let total = 0;
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, name, quantity, unit, unit_price, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const item of items) {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unit_price) || 0;
    const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
    total += lineTotal;
    insertItem.run(
      orderId,
      item.product_id || null,
      String(item.name || '').trim(),
      quantity,
      item.unit || 'lb',
      unitPrice,
      lineTotal
    );
  }
  db.prepare('UPDATE orders SET total = ? WHERE id = ?').run(Math.round(total * 100) / 100, orderId);
  return orderId;
});

router.post('/orders', (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items.filter((i) => i && i.name) : [];
  if (!items.length) return badRequest(res, 'Order needs at least one item');
  if (body.type === 'delivery' && !(body.address || '').trim() && !body.customer_id) {
    return badRequest(res, 'Delivery orders need an address');
  }

  // Resolve the customer: use an existing id, or match by phone, or create one.
  let customerId = body.customer_id;
  if (!customerId) {
    const { customer_name: name, customer_phone: phone } = body;
    if (!name || !phone) return badRequest(res, 'Customer name and phone are required');
    const normalized = normalizePhone(phone);
    if (!normalized) return badRequest(res, 'Phone number is invalid');
    const existing = db.prepare('SELECT * FROM customers WHERE phone = ?').get(normalized);
    if (existing) {
      customerId = existing.id;
      if (body.type === 'delivery' && (body.address || '').trim() && !existing.address) {
        db.prepare('UPDATE customers SET address = ? WHERE id = ?').run(body.address.trim(), existing.id);
      }
    } else {
      const info = db
        .prepare('INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)')
        .run(name.trim(), normalized, (body.address || '').trim());
      customerId = info.lastInsertRowid;
    }
  } else {
    const exists = db.prepare('SELECT id FROM customers WHERE id = ?').get(customerId);
    if (!exists) return badRequest(res, 'Customer not found');
  }

  // Delivery orders fall back to the customer's saved address.
  if (body.type === 'delivery' && !(body.address || '').trim()) {
    const customer = db.prepare('SELECT address FROM customers WHERE id = ?').get(customerId);
    body.address = customer.address || '';
    if (!body.address) return badRequest(res, 'Delivery orders need an address');
  }

  const orderId = createOrderTx(customerId, { ...body, items, address: body.address || '' });
  res.status(201).json(orderWithDetails(orderId));
});

const updateItemsTx = db.transaction((orderId, items) => {
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  let total = 0;
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, name, quantity, unit, unit_price, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const item of items) {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unit_price) || 0;
    const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
    total += lineTotal;
    insertItem.run(
      orderId,
      item.product_id || null,
      String(item.name || '').trim(),
      quantity,
      item.unit || 'lb',
      unitPrice,
      lineTotal
    );
  }
  return Math.round(total * 100) / 100;
});

router.put('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const body = req.body || {};
  let total = order.total;
  if (Array.isArray(body.items)) {
    const items = body.items.filter((i) => i && i.name);
    if (!items.length) return badRequest(res, 'Order needs at least one item');
    total = updateItemsTx(order.id, items);
  }
  db.prepare(
    `UPDATE orders SET type = ?, due_date = ?, time_slot = ?, address = ?, notes = ?, total = ?,
     updated_at = datetime('now') WHERE id = ?`
  ).run(
    body.type ?? order.type,
    body.due_date ?? order.due_date,
    body.time_slot ?? order.time_slot,
    (body.address ?? order.address).trim(),
    (body.notes ?? order.notes).trim(),
    total,
    order.id
  );
  res.json(orderWithDetails(order.id));
});

router.post('/orders/:id/status', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const { status, send_sms } = req.body || {};
  if (!ORDER_STATUSES.includes(status)) return badRequest(res, 'Invalid status');

  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
    status,
    order.id
  );

  const updated = orderWithDetails(order.id);
  const settings = getSettings();
  const shouldSend = send_sms !== undefined ? Boolean(send_sms) : settings.auto_sms === '1';
  let sms = null;
  if (shouldSend) {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
    const body = messageForStatus(updated, customer);
    if (body) {
      sms = await sendSms({
        phone: customer.phone,
        body,
        customerId: customer.id,
        orderId: order.id,
      });
    }
  }
  res.json({ order: updated, sms });
});

// ---------- Messages ----------

router.get('/messages', (req, res) => {
  const rows = db
    .prepare(
      `SELECT m.*, c.name AS customer_name FROM messages m
       LEFT JOIN customers c ON c.id = m.customer_id
       ORDER BY m.created_at DESC LIMIT 200`
    )
    .all();
  res.json(rows);
});

router.post('/messages/send', async (req, res) => {
  const { customer_id, order_id = null, body } = req.body || {};
  if (!body || !String(body).trim()) return badRequest(res, 'Message body is required');
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
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

router.get('/settings', (req, res) => {
  res.json({ ...getSettings(), twilio_configured: twilioConfigured() });
});

router.put('/settings', (req, res) => {
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
  setSettings(patch);
  res.json({ ...getSettings(), twilio_configured: twilioConfigured() });
});

router.get('/dashboard', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const counts = db
    .prepare(
      `SELECT
        SUM(CASE WHEN status NOT IN ('delivered', 'picked_up', 'cancelled') THEN 1 ELSE 0 END) AS open_orders,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_orders,
        SUM(CASE WHEN type = 'delivery' AND due_date = ? AND status NOT IN ('delivered', 'cancelled') THEN 1 ELSE 0 END) AS deliveries_today,
        SUM(CASE WHEN status = 'out_for_delivery' THEN 1 ELSE 0 END) AS out_for_delivery
       FROM orders`
    )
    .get(today);
  const todayOrders = db
    .prepare(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.due_date = ? OR (o.due_date = '' AND date(o.created_at) = ?)
       ORDER BY o.status = 'new' DESC, o.time_slot, o.created_at`
    )
    .all(today, today);
  res.json({ today, counts, todayOrders });
});

module.exports = router;
