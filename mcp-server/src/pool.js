import pg from "pg";

// Reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE from the environment automatically —
// same pattern as backend/src/db/pool.js. This is a read-only consumer of the same
// database backend writes to; it never runs a write query.
export const pool = new pg.Pool();

// Without this, an error on an idle pooled client is an unhandled 'error' event, which
// crashes the process — see backend/src/db/pool.js for the fuller explanation.
pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client:", err);
});
