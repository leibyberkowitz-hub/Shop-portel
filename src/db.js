const postgres = require('postgres');

// DATABASE_URL is the manual setting; POSTGRES_URL is set automatically by
// the Vercel <-> Supabase integration when the two projects are linked.
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

// max: 1 and prepare: false keep this safe for serverless (Vercel) and for
// Supabase's transaction-mode connection pooler.
//
// When DATABASE_URL is missing we don't crash at startup — every query throws
// a clear message instead, which the API error handler shows to the admin.
let sql;
if (url) {
  sql = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
    types: {
      numeric: { to: 1700, from: [1700], serialize: (v) => String(v), parse: (v) => Number(v) },
      int8: { to: 20, from: [20], serialize: (v) => String(v), parse: (v) => Number(v) },
    },
  });
} else {
  const fail = () => {
    throw new Error(
      'No database is configured — link the Supabase integration to this Vercel project ' +
        '(or set DATABASE_URL in Vercel → Settings → Environment Variables) and redeploy.'
    );
  };
  sql = new Proxy(fail, { apply: fail, get: fail });
}

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
