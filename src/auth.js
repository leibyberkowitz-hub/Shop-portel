const crypto = require('crypto');
const { sql } = require('./db');

const COOKIE = 'shop_session';
const SESSION_DAYS = 30;

// ---------- password hashing (scrypt) ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// ---------- session tokens ----------
// Signed with a random secret generated once and stored in settings, so no
// extra environment variable is needed and it survives serverless restarts.

let cachedSecret = null;
async function sessionSecret() {
  if (cachedSecret) return cachedSecret;
  const fresh = crypto.randomBytes(32).toString('hex');
  await sql`
    INSERT INTO settings (key, value) VALUES ('session_secret', ${fresh})
    ON CONFLICT (key) DO NOTHING`;
  const [row] = await sql`SELECT value FROM settings WHERE key = 'session_secret'`;
  cachedSecret = row.value;
  return cachedSecret;
}

async function createToken(userId) {
  const secret = await sessionSecret();
  const payload = `${userId}.${Date.now() + SESSION_DAYS * 864e5}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

async function verifyToken(token) {
  const [uid, exp, sig] = String(token || '').split('.');
  if (!uid || !exp || !sig) return null;
  const secret = await sessionSecret();
  const expected = crypto.createHmac('sha256', secret).update(`${uid}.${exp}`).digest('hex');
  const valid =
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid || Number(exp) < Date.now()) return null;
  return Number(uid);
}

// ---------- express plumbing ----------

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieAttrs(req, maxAge) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function currentUser(req) {
  const userId = await verifyToken(parseCookies(req)[COOKIE]);
  if (!userId) return null;
  const [user] = await sql`SELECT id, username, name FROM users WHERE id = ${userId}`;
  return user || null;
}

async function authMiddleware(req, res, next) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  req.user = user;
  next();
}

async function setSession(req, res, userId) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${await createToken(userId)}${cookieAttrs(req, 60 * 60 * 24 * SESSION_DAYS)}`
  );
}

function validCredentials(res, username, password, name) {
  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Name is required' });
    return false;
  }
  if (!username || username.trim().length < 3) {
    res.status(400).json({ error: 'Username must be at least 3 characters' });
    return false;
  }
  if (!password || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return false;
  }
  return true;
}

function registerAuthRoutes(app) {
  // Who am I? Also tells the UI when first-run setup is needed.
  app.get('/api/auth/me', async (req, res) => {
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM users`;
    if (count === 0) return res.json({ setup_required: true, authenticated: false });
    const user = await currentUser(req);
    res.json({ setup_required: false, authenticated: Boolean(user), user });
  });

  // First-run setup: create the first account. Only works while there are
  // no users at all, so it can never be used to break into a live shop.
  app.post('/api/setup', async (req, res) => {
    const { name = '', username = '', password = '' } = req.body || {};
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM users`;
    if (count > 0) return res.status(403).json({ error: 'Setup has already been completed' });
    if (!validCredentials(res, username, password, name)) return;
    const [user] = await sql`
      INSERT INTO users (username, name, password_hash)
      VALUES (${username.trim().toLowerCase()}, ${name.trim()}, ${hashPassword(password)})
      RETURNING id, username, name`;
    await setSession(req, res, user.id);
    res.status(201).json({ ok: true, user });
  });

  app.post('/api/login', async (req, res) => {
    const { username = '', password = '' } = req.body || {};
    const [user] = await sql`
      SELECT * FROM users WHERE username = ${String(username).trim().toLowerCase()}`;
    if (!user || !verifyPassword(String(password), user.password_hash)) {
      await new Promise((r) => setTimeout(r, 400)); // slow down brute-force attempts
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    await setSession(req, res, user.id);
    res.json({ ok: true, user: { id: user.id, username: user.username, name: user.name } });
  });

  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=${cookieAttrs(req, 0)}`);
    res.json({ ok: true });
  });
}

module.exports = { authMiddleware, registerAuthRoutes, hashPassword, validCredentials };
