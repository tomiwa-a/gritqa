# GritQA MVP — Ready for Online, Investment, YC

Goal: 2-minute demo, seamless connect, watchable indexing, minimal brain.

## 1. Instant demo — CUT, landing page is the pitch
- [x] Open review queue with sample data, no account — cut, static demo felt hollow
- [x] Add clear Try demo button on landing — cut with the page
- [x] Preserve guest actions and convert to real project on signup — cut

## 2. GitHub login polish — DONE
- [x] Keep next destination after login
- [x] Show friendly errors on callback fail
- [x] Land new users in onboarding, old users in dashboard

## 3. Device pairing without typing — DONE
- [x] Auto-open browser from CLI on connect — best-effort, skips silently on SSH/CI
- [x] Allow copy-link approve for remote terminals — verification URI already carried ?code=
- [x] Allow code entry page with short expiry and refresh — 10-min single-use + pending/expiry copy

## 4. Onboarding that detects reality — DONE (skip fix + gates; step auto-advance cut as overkill)
- [x] Advance steps only when link, index, draft actually happen — cut, gates + skip cover it
- [x] Allow leave and resume without redo
- [x] Add skip option that still creates project — skip lands on browsable dashboard with gates

## 5. Defer model key — DONE (dev bypass via service account; fail-closed kept, prompt only fires where it should)
- [x] Remove key requirement before first draft view
- [x] Prompt for key only when running agent job
- [x] Link directly to Settings AI from prompt

## 6. Indexing progress from CLI — DONE
- [x] Stream stage counts: list, hash, fast pass, AI pass, link — progress events + NDJSON + human stage lines
- [x] Show current file and cached vs fresh — per-file events, unchanged hashes + extraction hits
- [x] Report per-file failures with reasons — unreadable/unparseable/model failures with capped reasons

## 7. Indexing progress in dashboard — DONE
- [x] Show live status on codebase page — 5-rung stage list, 4s pulse, mirror counts, failure list
- [x] Show cached instant for unchanged repos — hash fast path serves stored snapshot, no parse/model
- [x] Handle resume after crash without restart — reindex heartbeat + claim reap + chunked mirror

## 8. Endpoint states — DONE (six states, derived; tested = proven but uncovered)
- [x] Use Indexed, Tested, Invalid only — extended to six: invalid, failing, approved, tested, draft, none
- [x] Show state chips in coverage grid — inherited via shared fill/label/tone maps + new dot tones
- [x] Keep history correct when endpoint changes — contradiction yields to newer passing runs

## 9. Recheck endpoint hand — DONE (step-first Look-again, merged revisions)
- [x] Add Look again button per endpoint and plan step — doubt rows + step drawer (spine stays navigation)
- [x] Re-read only that route chain plus last trial result — focused 12-call turn, trial evidence attached
- [x] Save note of what was re-read and what changed — merged verdict + revision row, version-locked

## 10. Trial-call promotion — DONE (read-scoped probe, fail-closed guards)
- [x] Trial-call indexed endpoints in sandbox — trial_call tool, auto-boot, no reset/repair/ledger
- [x] Promote to Tested on real response — proof table feeds the grid
- [x] Mark Invalid on 404 or contradiction — fake verdicts, disproved by newer passes

## 11. Delete invalid endpoints — DONE (no graveyard)
- [x] Allow fix invalid into correct shape — Look-again re-proves; proof row overwrites in place
- [x] Allow delete invalid with confirm — focus action with explicit consequences
- [x] Remove all references without litter — proof row + covers stripped via versioned revisions

## 12. Brain storage base
- [ ] Store facts per project with kind and source
- [ ] Track confidence: confirmed, plausible, disputed
- [ ] Never store secrets, only names

## 13. Brain recall in agent
- [ ] Recall facts before ask, draft, refine
- [ ] Prefer confirmed first, cap prompt size
- [ ] Cite sources in answers and plans

## 14. Brain visible page
- [ ] Add Brain page with totals and confirmed share
- [ ] List by Routes, Data, Auth, Conventions, Corrections
- [ ] Show source and version per fact

## 15. Manual brain edit
- [ ] Add fact by hand
- [ ] Edit statement inline
- [ ] Delete with confirm and audit

## 16. Remember this from chat
- [ ] Propose fact from conversation with one click save
- [ ] Require confirm before saving
- [ ] Refuse secrets with friendly message

## 17. Runs teach the brain
- [ ] Promote route to Tested after successful call
- [ ] Save live schema seen in runs
- [ ] Show new facts learned in run report

## 18. Stale handling
- [ ] Demote facts when file version changes
- [ ] Re-confirm on next run or recheck
- [ ] Show stale label in Brain page

## 19. SSH fallback
- [ ] Support copy-link approve when auto-open fails
- [ ] Show clear waiting state on both sides
- [ ] Allow refresh on expiry without restart

## 20. Public story pack
- [ ] Record 90 sec approve to proof video
- [ ] Write launch post with DB diff screenshots
- [ ] Track reads per draft, edits per plan, promotion rate
