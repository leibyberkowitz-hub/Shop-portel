const path = require('path');
const express = require('express');
const routes = require('./routes');
const { authMiddleware, registerAuthRoutes } = require('./auth');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

registerAuthRoutes(app);
app.use('/api', authMiddleware, routes);

// Static files — used when running the standalone server; on Vercel the
// public/ directory is served by the platform and never reaches this app.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Turn low-level database failures into messages an admin can act on.
function friendlyError(err) {
  const code = err && err.code;
  if (code === '28P01') return 'Database login failed — the password in DATABASE_URL is wrong.';
  if (code === '3D000') return 'Database does not exist — check the end of DATABASE_URL.';
  if (code === '42P01') return 'Database tables are missing — run db/schema.sql against the database.';
  if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'CONNECT_TIMEOUT', 'ECONNRESET'].includes(code)) {
    return 'Cannot reach the database — check the host/port in DATABASE_URL.';
  }
  if (err && err.message && err.message.includes('DATABASE_URL')) return err.message;
  return null;
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: friendlyError(err) || 'Internal server error' });
});

module.exports = app;
