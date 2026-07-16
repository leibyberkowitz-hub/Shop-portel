const crypto = require('crypto');

const COOKIE = 'shop_auth';

function authEnabled() {
  return Boolean(process.env.STAFF_PASSWORD);
}

// The session cookie value is an HMAC derived from the staff password, so
// changing the password invalidates all existing sessions.
function sessionToken() {
  return crypto
    .createHmac('sha256', process.env.STAFF_PASSWORD)
    .update('fish-shop-staff-session')
    .digest('hex');
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isAuthenticated(req) {
  if (!authEnabled()) return true;
  const cookie = parseCookies(req)[COOKIE] || '';
  const expected = sessionToken();
  return (
    cookie.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(expected))
  );
}

function cookieAttrs(req, maxAge) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function authMiddleware(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'Authentication required' });
}

function registerAuthRoutes(app) {
  app.post('/api/login', async (req, res) => {
    if (!authEnabled()) return res.json({ ok: true });
    const given = String((req.body || {}).password || '');
    const expected = process.env.STAFF_PASSWORD;
    const ok =
      given.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) {
      await new Promise((r) => setTimeout(r, 500)); // slow down brute-force attempts
      return res.status(401).json({ error: 'Wrong password' });
    }
    res.setHeader('Set-Cookie', `${COOKIE}=${sessionToken()}${cookieAttrs(req, 60 * 60 * 24 * 30)}`);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=${cookieAttrs(req, 0)}`);
    res.json({ ok: true });
  });
}

module.exports = { authMiddleware, registerAuthRoutes, authEnabled };
