const { sql } = require('./db');

function twilioConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
  );
}

async function logMessage(customerId, orderId, phone, body, status, detail = '') {
  await sql`
    INSERT INTO messages (customer_id, order_id, phone, body, status, detail)
    VALUES (${customerId}, ${orderId}, ${phone}, ${body}, ${status}, ${detail})`;
}

async function sendViaTwilio(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Twilio error (HTTP ${res.status})`);
  }
  return data.sid || '';
}

// Sends an SMS (via Twilio when configured, otherwise records a simulated
// send) and logs it to the messages table. Never throws — a failed text
// must not block order processing; failures are visible in the message log.
async function sendSms({ phone, body, customerId = null, orderId = null }) {
  if (!phone || !body) {
    return { ok: false, status: 'failed', detail: 'Missing phone or message body' };
  }
  if (!twilioConfigured()) {
    await logMessage(customerId, orderId, phone, body, 'simulated', 'Twilio not configured');
    console.log(`[SMS simulated] to ${phone}: ${body}`);
    return { ok: true, status: 'simulated' };
  }
  try {
    const twilioSid = await sendViaTwilio(phone, body);
    await logMessage(customerId, orderId, phone, body, 'sent', twilioSid);
    return { ok: true, status: 'sent' };
  } catch (err) {
    await logMessage(customerId, orderId, phone, body, 'failed', err.message);
    console.error(`[SMS failed] to ${phone}: ${err.message}`);
    return { ok: false, status: 'failed', detail: err.message };
  }
}

function renderTemplate(template, order, customer, settings) {
  let when = '';
  if (order.due_date) {
    when = order.type === 'delivery' ? `Delivery: ${order.due_date}` : `Pickup: ${order.due_date}`;
    if (order.time_slot) when += ` (${order.time_slot})`;
    when += '. ';
  }
  return template
    .replaceAll('{name}', customer.name)
    .replaceAll('{order}', String(order.id))
    .replaceAll('{shop}', settings.shop_name || 'our shop')
    .replaceAll('{total}', Number(order.total).toFixed(2))
    .replaceAll('{when}', when);
}

// Returns the rendered status-update text for an order, or null when no
// template applies to this status transition.
function messageForStatus(order, customer, settings) {
  const templateByStatus = {
    confirmed: settings.sms_confirmed,
    ready: settings.sms_ready,
    out_for_delivery: settings.sms_out_for_delivery,
    delivered: settings.sms_delivered,
    cancelled: settings.sms_cancelled,
  };
  const template = templateByStatus[order.status];
  if (!template) return null;
  return renderTemplate(template, order, customer, settings);
}

module.exports = { sendSms, messageForStatus, twilioConfigured };
