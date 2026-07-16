const postgres = require('postgres');

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Point it at your Postgres database ' +
      '(for Supabase: Project Settings → Database → Connection string, use the pooler URI).'
  );
}

// max: 1 and prepare: false keep this safe for serverless (Vercel) and for
// Supabase's transaction-mode connection pooler.
const sql = postgres(url, {
  max: 1,
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 15,
  types: {
    numeric: { to: 1700, from: [1700], serialize: (v) => String(v), parse: (v) => Number(v) },
    int8: { to: 20, from: [20], serialize: (v) => String(v), parse: (v) => Number(v) },
  },
});

async function getSettings() {
  const rows = await sql`SELECT key, value FROM settings`;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function setSettings(patch) {
  const entries = Object.entries(patch);
  if (!entries.length) return;
  await sql.begin(async (sql) => {
    for (const [key, value] of entries) {
      await sql`
        INSERT INTO settings (key, value) VALUES (${key}, ${String(value)})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
    }
  });
}

module.exports = { sql, getSettings, setSettings };
