-- Allows more than one market_metrics source to coexist for the same county/period —
-- e.g. the self-computed assessed-value snapshot AND a FRED-sourced real listing-price
-- snapshot for the same county in the same month, as two distinct rows rather than one
-- overwriting the other via the original (county, period_date, period_type) unique key.

-- Drops whatever the original unnamed UNIQUE(county, period_date, period_type) table
-- constraint actually got auto-named (Postgres's documented convention would make it
-- market_metrics_county_period_date_period_type_key, but looking it up dynamically here
-- rather than hardcoding that guess — if the guess were ever wrong, DROP CONSTRAINT IF
-- EXISTS would silently no-op and the ADD CONSTRAINT below would succeed too, leaving
-- BOTH constraints active and the old, narrower one still silently blocking the
-- multi-source inserts this migration exists to allow). market_metrics has exactly one
-- unique constraint (this one) besides its primary key (contype 'p', unaffected).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'market_metrics'
      AND con.contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE market_metrics DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE market_metrics
  ADD CONSTRAINT market_metrics_county_period_date_period_type_source_key
  UNIQUE (county, period_date, period_type, source);
