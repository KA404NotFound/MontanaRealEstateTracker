// Node/pg connection failures (e.g. `db` not resolvable/reachable yet) commonly surface as
// an AggregateError from dual-stack address resolution — its top-level `.message` is empty
// string, with the real per-attempt messages in `.errors`. Plain `err.message` on one of
// these silently logs nothing useful, which is exactly the case that matters most here
// (the DB being unreachable). Use this anywhere an error gets logged.
export function describeError(err) {
  if (err instanceof AggregateError && err.errors?.length) {
    return err.errors.map((e) => e?.message || String(e)).join("; ");
  }
  return err?.message || String(err);
}
