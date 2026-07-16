/* Fish Shop Manager — single-page UI */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const main = $('#main');

const STATUS_LABELS = {
  new: 'New',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  picked_up: 'Picked up',
  cancelled: 'Cancelled',
};

// The natural next steps from each status, per order type.
const NEXT_STATUSES = {
  pickup: {
    new: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'ready', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['picked_up', 'cancelled'],
    picked_up: [],
    cancelled: [],
  },
  delivery: {
    new: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'ready', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['out_for_delivery', 'cancelled'],
    out_for_delivery: ['delivered', 'cancelled'],
    delivered: [],
    cancelled: [],
  },
};

let products = [];
let settings = {};

// ---------- helpers ----------

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast${isError ? ' error' : ''}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function fmtDate(d) {
  if (!d) return '—';
  return d;
}

function badge(text, cls) {
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}

function statusBadge(status) {
  return badge(STATUS_LABELS[status] || status, status);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function openModal(html) {
  $('#modal').innerHTML = html;
  $('#modal-backdrop').classList.remove('hidden');
}

function closeModal() {
  $('#modal-backdrop').classList.add('hidden');
  $('#modal').innerHTML = '';
}

$('#modal-backdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modal-backdrop') closeModal();
});

// ---------- navigation ----------

const views = {};
let currentView = 'dashboard';

function navigate(view, arg) {
  currentView = view;
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  views[view](arg);
}

$$('.nav-btn').forEach((btn) =>
  btn.addEventListener('click', () => navigate(btn.dataset.view))
);
$('#new-order-btn').addEventListener('click', () => openNewOrderModal());

// ---------- shared renderers ----------

function ordersTable(orders, { showDate = true } = {}) {
  if (!orders.length) return '<div class="empty">No orders found.</div>';
  const rows = orders
    .map(
      (o) => `
      <tr class="clickable" data-order="${o.id}">
        <td>#${o.id}</td>
        <td><strong>${esc(o.customer_name)}</strong><br><span class="muted">${esc(o.customer_phone)}</span></td>
        <td>${badge(o.type, o.type)}</td>
        ${showDate ? `<td>${esc(fmtDate(o.due_date))}${o.time_slot ? `<br><span class="muted">${esc(o.time_slot)}</span>` : ''}</td>` : ''}
        <td>${statusBadge(o.status)}</td>
        <td>${money(o.total)}</td>
      </tr>`
    )
    .join('');
  return `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Order</th><th>Customer</th><th>Type</th>${showDate ? '<th>Due</th>' : ''}<th>Status</th><th>Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function bindOrderRows(container) {
  $$('tr[data-order]', container).forEach((tr) =>
    tr.addEventListener('click', () => openOrderModal(Number(tr.dataset.order)))
  );
}

// ---------- dashboard ----------

views.dashboard = async function renderDashboard() {
  const d = await api('/dashboard');
  main.innerHTML = `
    <div class="view-header"><h1>Today — ${esc(d.today)}</h1></div>
    <div class="stats">
      <div class="stat"><div class="num">${d.counts.open_orders || 0}</div><div class="label">Open orders</div></div>
      <div class="stat"><div class="num">${d.counts.new_orders || 0}</div><div class="label">New (unconfirmed)</div></div>
      <div class="stat"><div class="num">${d.counts.deliveries_today || 0}</div><div class="label">Deliveries today</div></div>
      <div class="stat"><div class="num">${d.counts.out_for_delivery || 0}</div><div class="label">Out for delivery</div></div>
    </div>
    <h2>Due today</h2>
    ${ordersTable(d.todayOrders, { showDate: false })}
  `;
  bindOrderRows(main);
};

// ---------- orders ----------

views.orders = async function renderOrders() {
  main.innerHTML = `
    <div class="view-header">
      <h1>Orders</h1>
      <div class="filters">
        <input id="f-q" placeholder="Search name / phone / #" />
        <select id="f-status">
          <option value="open">Open</option>
          <option value="">All</option>
          ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <select id="f-type">
          <option value="">All types</option>
          <option value="pickup">Pickup</option>
          <option value="delivery">Delivery</option>
        </select>
        <input id="f-date" type="date" />
      </div>
    </div>
    <div id="orders-list"></div>
  `;
  async function load() {
    const params = new URLSearchParams();
    const q = $('#f-q').value.trim();
    if (q) params.set('q', q);
    if ($('#f-status').value) params.set('status', $('#f-status').value);
    if ($('#f-type').value) params.set('type', $('#f-type').value);
    if ($('#f-date').value) params.set('date', $('#f-date').value);
    const orders = await api(`/orders?${params}`);
    $('#orders-list').innerHTML = ordersTable(orders);
    bindOrderRows($('#orders-list'));
  }
  ['f-q', 'f-status', 'f-type', 'f-date'].forEach((id) =>
    $(`#${id}`).addEventListener('input', load)
  );
  await load();
};

// ---------- deliveries ----------

views.deliveries = async function renderDeliveries() {
  main.innerHTML = `
    <div class="view-header">
      <h1>Deliveries</h1>
      <div class="filters">
        <label style="margin:0">Date</label>
        <input id="d-date" type="date" value="${today()}" />
      </div>
    </div>
    <div id="deliveries-list"></div>
  `;
  async function load() {
    const date = $('#d-date').value;
    const orders = await api(`/orders?type=delivery&date=${date}`);
    const active = orders.filter((o) => !['cancelled'].includes(o.status));
    if (!active.length) {
      $('#deliveries-list').innerHTML = '<div class="empty">No deliveries scheduled for this date.</div>';
      return;
    }
    const rows = active
      .map(
        (o) => `
        <tr class="clickable" data-order="${o.id}">
          <td>#${o.id}</td>
          <td><strong>${esc(o.customer_name)}</strong><br><span class="muted">${esc(o.customer_phone)}</span></td>
          <td>${esc(o.address || '—')}</td>
          <td>${esc(o.time_slot || '—')}</td>
          <td>${statusBadge(o.status)}</td>
          <td>${money(o.total)}</td>
        </tr>`
      )
      .join('');
    $('#deliveries-list').innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>Customer</th><th>Address</th><th>Time</th><th>Status</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
    bindOrderRows($('#deliveries-list'));
  }
  $('#d-date').addEventListener('input', load);
  await load();
};

// ---------- customers ----------

views.customers = async function renderCustomers() {
  main.innerHTML = `
    <div class="view-header">
      <h1>Customers</h1>
      <div class="filters">
        <input id="c-q" placeholder="Search name / phone / address" />
        <button class="btn primary" id="c-add">+ Add customer</button>
      </div>
    </div>
    <div id="customers-list"></div>
  `;
  async function load() {
    const q = $('#c-q').value.trim();
    const customers = await api(`/customers?q=${encodeURIComponent(q)}`);
    if (!customers.length) {
      $('#customers-list').innerHTML = '<div class="empty">No customers yet.</div>';
      return;
    }
    const rows = customers
      .map(
        (c) => `
        <tr class="clickable" data-customer="${c.id}">
          <td><strong>${esc(c.name)}</strong></td>
          <td>${esc(c.phone)}</td>
          <td>${esc(c.address || '—')}</td>
          <td class="muted">${esc(c.notes || '')}</td>
        </tr>`
      )
      .join('');
    $('#customers-list').innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Phone</th><th>Address</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
    $$('tr[data-customer]', $('#customers-list')).forEach((tr) =>
      tr.addEventListener('click', () => openCustomerModal(Number(tr.dataset.customer)))
    );
  }
  $('#c-q').addEventListener('input', load);
  $('#c-add').addEventListener('click', () => openCustomerForm());
  await load();
};

function openCustomerForm(customer = null) {
  openModal(`
    <h1>${customer ? 'Edit customer' : 'New customer'}</h1>
    <div class="field"><label>Name</label><input id="cf-name" value="${esc(customer?.name || '')}" /></div>
    <div class="field"><label>Phone</label><input id="cf-phone" value="${esc(customer?.phone || '')}" placeholder="+1 555 123 4567" /></div>
    <div class="field"><label>Address</label><input id="cf-address" value="${esc(customer?.address || '')}" /></div>
    <div class="field"><label>Notes</label><textarea id="cf-notes" rows="2">${esc(customer?.notes || '')}</textarea></div>
    <div class="modal-actions">
      <button class="btn" id="cf-cancel">Cancel</button>
      <button class="btn primary" id="cf-save">Save</button>
    </div>
  `);
  $('#cf-cancel').addEventListener('click', closeModal);
  $('#cf-save').addEventListener('click', async () => {
    const body = {
      name: $('#cf-name').value.trim(),
      phone: $('#cf-phone').value.trim(),
      address: $('#cf-address').value.trim(),
      notes: $('#cf-notes').value.trim(),
    };
    try {
      if (customer) await api(`/customers/${customer.id}`, { method: 'PUT', body });
      else await api('/customers', { method: 'POST', body });
      closeModal();
      toast('Customer saved');
      if (currentView === 'customers') navigate('customers');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function openCustomerModal(id) {
  const c = await api(`/customers/${id}`);
  openModal(`
    <h1>${esc(c.name)}</h1>
    <p class="muted">${esc(c.phone)}${c.address ? ' · ' + esc(c.address) : ''}</p>
    ${c.notes ? `<p style="margin:8px 0">${esc(c.notes)}</p>` : ''}
    <div class="status-actions">
      <button class="btn small" id="cm-edit">Edit</button>
      <button class="btn small" id="cm-text">Send text</button>
      <button class="btn small primary" id="cm-order">New order</button>
    </div>
    <h2>Order history</h2>
    ${
      c.orders.length
        ? `<div class="table-wrap"><table><tbody>${c.orders
            .map(
              (o) =>
                `<tr class="clickable" data-order="${o.id}"><td>#${o.id}</td><td>${esc(fmtDate(o.due_date))}</td><td>${statusBadge(o.status)}</td><td>${money(o.total)}</td></tr>`
            )
            .join('')}</tbody></table></div>`
        : '<div class="empty">No orders yet.</div>'
    }
    <div class="modal-actions"><button class="btn" id="cm-close">Close</button></div>
  `);
  $('#cm-close').addEventListener('click', closeModal);
  $('#cm-edit').addEventListener('click', () => openCustomerForm(c));
  $('#cm-order').addEventListener('click', () => openNewOrderModal(c));
  $('#cm-text').addEventListener('click', () => openSendTextModal(c));
  bindOrderRows($('#modal'));
}

function openSendTextModal(customer, orderId = null) {
  openModal(`
    <h1>Text ${esc(customer.name)}</h1>
    <p class="muted">To: ${esc(customer.phone)}</p>
    <div class="field"><label>Message</label><textarea id="st-body" rows="4" placeholder="Type your message..."></textarea></div>
    <div class="modal-actions">
      <button class="btn" id="st-cancel">Cancel</button>
      <button class="btn primary" id="st-send">Send text</button>
    </div>
  `);
  $('#st-cancel').addEventListener('click', closeModal);
  $('#st-send').addEventListener('click', async () => {
    try {
      const result = await api('/messages/send', {
        method: 'POST',
        body: { customer_id: customer.id, order_id: orderId, body: $('#st-body').value },
      });
      closeModal();
      toast(result.status === 'simulated' ? 'Text recorded (simulation mode — no SMS provider configured)' : 'Text sent');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- products ----------

views.products = async function renderProducts() {
  const list = await api('/products?all=1');
  main.innerHTML = `
    <div class="view-header">
      <h1>Products</h1>
      <button class="btn primary" id="p-add">+ Add product</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Unit</th><th>Price</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${list
          .map(
            (p) => `
          <tr>
            <td>${esc(p.name)}</td>
            <td>${esc(p.unit)}</td>
            <td>${money(p.price)} / ${esc(p.unit)}</td>
            <td>${p.active ? badge('Active', 'ready') : badge('Hidden', 'cancelled')}</td>
            <td>
              <button class="btn small" data-edit="${p.id}">Edit</button>
              <button class="btn small ${p.active ? 'danger' : ''}" data-toggle="${p.id}">${p.active ? 'Hide' : 'Show'}</button>
            </td>
          </tr>`
          )
          .join('') || '<tr><td colspan="5" class="empty">No products. Add your fish and prices.</td></tr>'}
      </tbody>
    </table></div>
  `;
  $('#p-add').addEventListener('click', () => openProductForm());
  $$('button[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openProductForm(list.find((p) => p.id === Number(b.dataset.edit))))
  );
  $$('button[data-toggle]').forEach((b) =>
    b.addEventListener('click', async () => {
      const p = list.find((x) => x.id === Number(b.dataset.toggle));
      await api(`/products/${p.id}`, { method: 'PUT', body: { active: !p.active } });
      navigate('products');
    })
  );
};

function openProductForm(product = null) {
  openModal(`
    <h1>${product ? 'Edit product' : 'New product'}</h1>
    <div class="field"><label>Name</label><input id="pf-name" value="${esc(product?.name || '')}" placeholder="e.g. Salmon fillet" /></div>
    <div class="row">
      <div class="field"><label>Unit</label>
        <select id="pf-unit">
          ${['lb', 'kg', 'each', 'piece'].map((u) => `<option ${product?.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Price per unit</label><input id="pf-price" type="number" step="0.01" min="0" value="${product?.price ?? ''}" /></div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="pf-cancel">Cancel</button>
      <button class="btn primary" id="pf-save">Save</button>
    </div>
  `);
  $('#pf-cancel').addEventListener('click', closeModal);
  $('#pf-save').addEventListener('click', async () => {
    const body = {
      name: $('#pf-name').value.trim(),
      unit: $('#pf-unit').value,
      price: Number($('#pf-price').value) || 0,
    };
    try {
      if (product) await api(`/products/${product.id}`, { method: 'PUT', body });
      else await api('/products', { method: 'POST', body });
      closeModal();
      navigate('products');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- messages ----------

views.messages = async function renderMessages() {
  const messages = await api('/messages');
  main.innerHTML = `
    <div class="view-header"><h1>Message log</h1></div>
    ${
      messages.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>When</th><th>To</th><th>Message</th><th>Order</th><th>Status</th></tr></thead>
            <tbody>${messages
              .map(
                (m) => `
              <tr>
                <td class="muted">${esc(m.created_at)}</td>
                <td>${esc(m.customer_name || '')}<br><span class="muted">${esc(m.phone)}</span></td>
                <td class="msg-body">${esc(m.body)}</td>
                <td>${m.order_id ? `#${m.order_id}` : '—'}</td>
                <td>${badge(m.status, m.status)}${m.status === 'failed' && m.detail ? `<br><span class="muted">${esc(m.detail)}</span>` : ''}</td>
              </tr>`
              )
              .join('')}</tbody>
          </table></div>`
        : '<div class="empty">No messages sent yet. Texts are sent automatically when you update an order\'s status.</div>'
    }
  `;
};

// ---------- settings ----------

views.settings = async function renderSettings() {
  const s = await api('/settings');
  const templateField = (key, label) => `
    <div class="field"><label>${label}</label>
      <textarea data-setting="${key}" rows="2">${esc(s[key])}</textarea>
    </div>`;
  main.innerHTML = `
    <div class="view-header"><h1>Settings</h1></div>
    <div class="panel">
      <div class="field"><label>Shop name (used in texts)</label>
        <input data-setting="shop_name" value="${esc(s.shop_name)}" />
      </div>
      <div class="field"><label>
        <input type="checkbox" id="s-auto" style="width:auto" ${s.auto_sms === '1' ? 'checked' : ''} />
        Automatically text customers on status updates
      </label></div>
    </div>
    <div class="panel">
      <h2 style="margin-top:0">SMS provider</h2>
      <p class="muted" style="margin-bottom:8px">
        ${s.twilio_configured
          ? '✅ Twilio is configured — texts are really sent to customers.'
          : '⚠️ Simulation mode: texts are logged but not actually sent. To send real texts, set the TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER environment variables on the server and restart (see README).'}
      </p>
    </div>
    <div class="panel">
      <h2 style="margin-top:0">Message templates</h2>
      <p class="muted" style="margin-bottom:12px">Placeholders: {name} customer name · {order} order number · {shop} shop name · {total} order total · {when} pickup/delivery date &amp; time</p>
      ${templateField('sms_confirmed', 'Order confirmed')}
      ${templateField('sms_ready', 'Ready for pickup')}
      ${templateField('sms_out_for_delivery', 'Out for delivery')}
      ${templateField('sms_delivered', 'Delivered')}
      ${templateField('sms_cancelled', 'Cancelled')}
    </div>
    <button class="btn primary big" id="s-save">Save settings</button>
  `;
  $('#s-save').addEventListener('click', async () => {
    const body = { auto_sms: $('#s-auto').checked ? '1' : '0' };
    $$('[data-setting]').forEach((el) => (body[el.dataset.setting] = el.value));
    await api('/settings', { method: 'PUT', body });
    settings = await api('/settings');
    $('#brand-name').textContent = settings.shop_name || 'Fish Shop';
    toast('Settings saved');
  });
};

// ---------- order detail ----------

async function openOrderModal(id) {
  const o = await api(`/orders/${id}`);
  const next = (NEXT_STATUSES[o.type] || {})[o.status] || [];
  const itemsRows = o.items
    .map(
      (i) =>
        `<tr><td>${esc(i.name)}</td><td>${i.quantity} ${esc(i.unit)}</td><td>${money(i.unit_price)}/${esc(i.unit)}</td><td>${money(i.line_total)}</td></tr>`
    )
    .join('');
  openModal(`
    <h1>Order #${o.id} ${statusBadge(o.status)} ${badge(o.type, o.type)}</h1>
    <p class="muted" style="margin:6px 0 2px">
      <strong>${esc(o.customer_name)}</strong> · ${esc(o.customer_phone)}
    </p>
    ${o.type === 'delivery' ? `<p class="muted">📍 ${esc(o.address || 'No address!')}</p>` : ''}
    <p class="muted">Due: ${esc(fmtDate(o.due_date))}${o.time_slot ? ` (${esc(o.time_slot)})` : ''} · Placed: ${esc(o.created_at)}</p>
    ${o.notes ? `<p style="margin:8px 0"><em>${esc(o.notes)}</em></p>` : ''}
    <div class="table-wrap" style="margin:12px 0"><table>
      <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
      <tbody>${itemsRows}<tr><td colspan="3" style="text-align:right"><strong>Total</strong></td><td><strong>${money(o.total)}</strong></td></tr></tbody>
    </table></div>
    ${
      next.length
        ? `<label style="margin-bottom:6px">Move to:</label>
           <div class="status-actions">
             ${next
               .map(
                 (s) =>
                   `<button class="btn ${s === 'cancelled' ? 'danger' : 'primary'}" data-status="${s}">${STATUS_LABELS[s]}</button>`
               )
               .join('')}
           </div>
           <label style="font-weight:400"><input type="checkbox" id="om-sms" style="width:auto" ${settings.auto_sms === '1' ? 'checked' : ''} /> Text the customer about this update</label>`
        : ''
    }
    ${
      o.messages.length
        ? `<h2>Texts for this order</h2><div class="table-wrap"><table><tbody>${o.messages
            .map(
              (m) =>
                `<tr><td class="muted">${esc(m.created_at)}</td><td class="msg-body">${esc(m.body)}</td><td>${badge(m.status, m.status)}</td></tr>`
            )
            .join('')}</tbody></table></div>`
        : ''
    }
    <div class="modal-actions">
      <button class="btn" id="om-text">Send custom text</button>
      <button class="btn" id="om-close">Close</button>
    </div>
  `);
  $('#om-close').addEventListener('click', closeModal);
  $('#om-text').addEventListener('click', () =>
    openSendTextModal({ id: o.customer_id, name: o.customer_name, phone: o.customer_phone }, o.id)
  );
  $$('button[data-status]', $('#modal')).forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        const result = await api(`/orders/${o.id}/status`, {
          method: 'POST',
          body: { status: btn.dataset.status, send_sms: $('#om-sms')?.checked ?? false },
        });
        let note = `Order #${o.id} → ${STATUS_LABELS[btn.dataset.status]}`;
        if (result.sms) {
          note +=
            result.sms.status === 'sent'
              ? ' · customer texted'
              : result.sms.status === 'simulated'
                ? ' · text recorded (simulation mode)'
                : ' · ⚠ text failed';
        }
        toast(note, result.sms?.status === 'failed');
        closeModal();
        navigate(currentView);
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
}

// ---------- new order ----------

async function openNewOrderModal(customer = null) {
  products = await api('/products');
  openModal(`
    <h1>New phone order</h1>
    <div class="row">
      <div class="field"><label>Customer phone</label>
        <input id="no-phone" value="${esc(customer?.phone || '')}" placeholder="Type phone — existing customers auto-fill" />
      </div>
      <div class="field"><label>Customer name</label>
        <input id="no-name" value="${esc(customer?.name || '')}" />
      </div>
    </div>
    <div class="row">
      <div class="field"><label>Order type</label>
        <select id="no-type">
          <option value="pickup">Pickup</option>
          <option value="delivery">Delivery</option>
        </select>
      </div>
      <div class="field"><label>Due date</label><input id="no-date" type="date" value="${today()}" /></div>
      <div class="field"><label>Time</label><input id="no-slot" placeholder="e.g. 2-4pm" /></div>
    </div>
    <div class="field hidden" id="no-address-field"><label>Delivery address</label>
      <input id="no-address" value="${esc(customer?.address || '')}" />
    </div>
    <label>Items</label>
    <div class="items-editor">
      <div id="no-items"></div>
      <button class="btn small" id="no-add-item">+ Add item</button>
      <div class="order-total" id="no-total">Total: $0.00</div>
    </div>
    <div class="field"><label>Order notes</label><input id="no-notes" placeholder="e.g. filleted, no skin" /></div>
    <div class="modal-actions">
      <button class="btn" id="no-cancel">Cancel</button>
      <button class="btn primary" id="no-save">Create order</button>
    </div>
  `);

  const itemsEl = $('#no-items');

  function productOptions(selectedId) {
    return (
      '<option value="">Custom item…</option>' +
      products
        .map(
          (p) =>
            `<option value="${p.id}" data-price="${p.price}" data-unit="${p.unit}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)} (${money(p.price)}/${esc(p.unit)})</option>`
        )
        .join('')
    );
  }

  function addItemRow() {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <select class="it-product">${productOptions()}</select>
      <input class="it-qty" type="number" step="0.25" min="0" value="1" title="Quantity" />
      <select class="it-unit">${['lb', 'kg', 'each', 'piece'].map((u) => `<option>${u}</option>`).join('')}</select>
      <input class="it-price" type="number" step="0.01" min="0" placeholder="$/unit" title="Price per unit" />
      <div class="line-total">$0.00</div>
      <button class="item-remove" title="Remove">✕</button>
    `;
    itemsEl.appendChild(row);
    const productSel = $('.it-product', row);
    productSel.addEventListener('change', () => {
      const opt = productSel.selectedOptions[0];
      if (opt && opt.value) {
        $('.it-price', row).value = opt.dataset.price;
        $('.it-unit', row).value = opt.dataset.unit;
      }
      recalc();
    });
    ['input', 'change'].forEach((ev) => {
      $('.it-qty', row).addEventListener(ev, recalc);
      $('.it-price', row).addEventListener(ev, recalc);
    });
    $('.item-remove', row).addEventListener('click', () => {
      row.remove();
      recalc();
    });
  }

  function collectItems() {
    return $$('.item-row', itemsEl)
      .map((row) => {
        const sel = $('.it-product', row);
        const opt = sel ? sel.selectedOptions[0] : null;
        const name = opt && opt.value
          ? opt.textContent.replace(/\s*\(.*\)$/, '')
          : ($('.it-custom', row)?.value || '').trim();
        return {
          product_id: opt && opt.value ? Number(opt.value) : null,
          name,
          quantity: Number($('.it-qty', row).value) || 0,
          unit: $('.it-unit', row).value,
          unit_price: Number($('.it-price', row).value) || 0,
        };
      })
      .filter((i) => i.name && i.quantity > 0);
  }

  function recalc() {
    let total = 0;
    $$('.item-row', itemsEl).forEach((row) => {
      const line = (Number($('.it-qty', row).value) || 0) * (Number($('.it-price', row).value) || 0);
      total += line;
      $('.line-total', row).textContent = money(line);
    });
    $('#no-total').textContent = `Total: ${money(total)}`;
  }

  // Custom item: when "Custom item…" is chosen, swap the select for a text input.
  itemsEl.addEventListener('change', (e) => {
    if (e.target.classList.contains('it-product') && !e.target.value) {
      const input = document.createElement('input');
      input.className = 'it-custom';
      input.placeholder = 'Item name';
      e.target.replaceWith(input);
      input.focus();
    }
  });

  $('#no-add-item').addEventListener('click', addItemRow);
  addItemRow();

  const typeSel = $('#no-type');
  function syncAddress() {
    $('#no-address-field').classList.toggle('hidden', typeSel.value !== 'delivery');
  }
  typeSel.addEventListener('change', syncAddress);
  syncAddress();

  // Phone lookup: auto-fill returning customers.
  let matchedCustomer = customer;
  $('#no-phone').addEventListener('blur', async () => {
    const phone = $('#no-phone').value.replace(/[^\d+]/g, '');
    if (phone.length < 7) return;
    const matches = await api(`/customers?q=${encodeURIComponent(phone)}`);
    const exact = matches.find((c) => c.phone === phone);
    if (exact) {
      matchedCustomer = exact;
      $('#no-name').value = exact.name;
      if (!$('#no-address').value) $('#no-address').value = exact.address || '';
      toast(`Returning customer: ${exact.name}`);
    } else {
      matchedCustomer = null;
    }
  });

  $('#no-cancel').addEventListener('click', closeModal);
  $('#no-save').addEventListener('click', async () => {
    const items = collectItems();
    if (!items.length) return toast('Add at least one item', true);
    const body = {
      customer_id: matchedCustomer?.id,
      customer_name: $('#no-name').value.trim(),
      customer_phone: $('#no-phone').value.trim(),
      type: typeSel.value,
      due_date: $('#no-date').value,
      time_slot: $('#no-slot').value.trim(),
      address: $('#no-address').value.trim(),
      notes: $('#no-notes').value.trim(),
      items,
    };
    try {
      const order = await api('/orders', { method: 'POST', body });
      closeModal();
      toast(`Order #${order.id} created`);
      navigate(currentView);
      openOrderModal(order.id);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- boot ----------

(async function init() {
  try {
    [products, settings] = await Promise.all([api('/products'), api('/settings')]);
    $('#brand-name').textContent = settings.shop_name || 'Fish Shop';
    $('#sms-mode').textContent = settings.twilio_configured
      ? 'SMS: live (Twilio)'
      : 'SMS: simulation mode — texts are logged, not sent';
    navigate('dashboard');
  } catch (err) {
    main.innerHTML = `<div class="empty">Failed to load: ${esc(err.message)}</div>`;
  }
})();
