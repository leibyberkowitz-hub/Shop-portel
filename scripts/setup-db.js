// Applies db/schema.sql to the database in DATABASE_URL. Idempotent.
// Usage: npm run db:setup   (or DATABASE_URL=... node scripts/setup-db.js)
require('../src/env');
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

(async () => {
  const sql = postgres(url, { max: 1, connect_timeout: 15 });
  try {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await sql.unsafe(schema);
    console.log('Schema applied ✅');
  } finally {
    await sql.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
