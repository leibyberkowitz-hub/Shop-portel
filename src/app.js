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

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
