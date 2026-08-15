import pg from "pg";

// node-postgres reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE from the environment
// automatically when Pool() is called with no config — docker-compose sets these.
export const pool = new pg.Pool();
