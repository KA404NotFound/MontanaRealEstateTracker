import pg from "pg";
import { describeError } from "../lib/describeError.js";

// node-postgres reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE from the environment
// automatically when Pool() is called with no config — docker-compose sets these.
export const pool = new pg.Pool();

// Without this, an error on an idle pooled client (e.g. a transient network blip between
// `backend` and `db`) is an unhandled 'error' event, which crashes the whole process —
// a well-documented node-postgres gotcha. Log and let the pool recycle the client instead.
pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client:", describeError(err));
});
