// A failed pg connection (e.g. `db` unreachable) commonly throws an AggregateError from
// dual-stack address resolution — its top-level .message is empty, with the real
// per-attempt messages in .errors. Same issue as backend/src/lib/describeError.js;
// duplicated here rather than shared since mcp-server is a separate, standalone package.
export function describeError(err) {
  if (err instanceof AggregateError && err.errors?.length) {
    return err.errors.map((e) => e?.message || String(e)).join("; ");
  }
  return err?.message || String(err);
}
