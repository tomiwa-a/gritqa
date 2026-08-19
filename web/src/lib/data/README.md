# The data seam

Every screen reads through this directory and nothing else. Today each function returns a
constant out of `src/lib/mock/`; when a table goes live, one function body changes and its
callers do not.

Three rules that keep it a seam rather than a second mock:

1. **Async from the start**, even while the source is a constant. The signature is the
   contract, and a synchronous contract cannot become a query without touching every caller.
2. **Shapes come from `mock/types.ts`.** That file is the read model, not a mock artefact —
   30 modules import it for types alone. It outlives the mock data.
3. **Fetching lives here; deriving does not.** `lib/plan.ts` and `lib/runs.ts` take their
   data as parameters and stay pure. Same-named files in the parent directory
   (`lib/runs.ts`, `lib/coverage.ts`, `lib/commits.ts`) are the derivations; the ones here
   are the reads.
