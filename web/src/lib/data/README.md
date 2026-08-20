# The data seam

Every screen reads through this directory and nothing else. That was the point of building
it while the source was still a set of module constants: each entity then moved to Postgres
one function body at a time, and no caller changed. The constants are gone now — every read
here is a query — and the seam is what made that a sequence of small commits instead of one
large one.

Three rules that keep it a seam rather than a second mock:

1. **Async from the start**, even while the source is a constant. The signature is the
   contract, and a synchronous contract cannot become a query without touching every caller.
2. **Shapes come from [`../model.ts`](../model.ts).** One read model, imported by 50-odd
   modules for types alone. It lived in `mock/` while the mock did, and moved out when the
   mock was deleted: the shapes were never the mock's.
3. **Fetching lives here; deriving does not.** `lib/plan.ts` and `lib/runs.ts` take their
   data as parameters and stay pure. Same-named files in the parent directory
   (`lib/runs.ts`, `lib/coverage.ts`, `lib/commits.ts`) are the derivations; the ones here
   are the reads.

Two conventions worth knowing before adding one:

- **Scope first.** Every read starts at `currentScope()` and returns empty when there is no
  session, so a signed-out request renders an empty screen rather than throwing.
- **Wrapped in React `cache`.** Several components read the same entity in one render, and
  the cache is what keeps that one query. It is per-request, so it never serves one
  developer's rows to another.
