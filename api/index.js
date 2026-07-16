// Vercel serverless entry point: all /api/* requests are rewritten here
// (see vercel.json) and handled by the Express app.
require('../src/env');
module.exports = require('../src/app');
