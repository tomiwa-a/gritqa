# GritQA MVP — Ready for Online, Investment, YC

Goal: 2-minute demo, seamless connect, watchable indexing, minimal brain.

## 1. Instant demo — CUT, landing page is the pitch
- [x] Open review queue with sample data, no account — cut, static demo felt hollow
- [x] Add clear Try demo button on landing — cut with the page
- [x] Preserve guest actions and convert to real project on signup — cut

## 2. GitHub login polish
- [ ] Keep next destination after login
- [ ] Show friendly errors on callback fail
- [ ] Land new users in onboarding, old users in dashboard

## 3. Device pairing without typing
- [ ] Auto-open browser from CLI on connect
- [ ] Allow copy-link approve for remote terminals
- [ ] Allow code entry page with short expiry and refresh

## 4. Onboarding that detects reality
- [ ] Advance steps only when link, index, draft actually happen
- [ ] Allow leave and resume without redo
- [ ] Add skip option that still creates project

## 5. Defer model key
- [ ] Remove key requirement before first draft view
- [ ] Prompt for key only when running agent job
- [ ] Link directly to Settings AI from prompt

## 6. Indexing progress from CLI
- [ ] Stream stage counts: list, hash, fast pass, AI pass, link
- [ ] Show current file and cached vs fresh
- [ ] Report per-file failures with reasons

## 7. Indexing progress in dashboard
- [ ] Show live status on codebase page
- [ ] Show cached instant for unchanged repos
- [ ] Handle resume after crash without restart

## 8. Endpoint states
- [ ] Use Indexed, Tested, Invalid only
- [ ] Show state chips in coverage grid
- [ ] Keep history correct when endpoint changes

## 9. Recheck endpoint hand
- [ ] Add Look again button per endpoint and plan step
- [ ] Re-read only that route chain plus last trial result
- [ ] Save note of what was re-read and what changed

## 10. Trial-call promotion
- [ ] Trial-call indexed endpoints in sandbox
- [ ] Promote to Tested on real response
- [ ] Mark Invalid on 404 or contradiction

## 11. Delete invalid endpoints
- [ ] Allow fix invalid into correct shape
- [ ] Allow delete invalid with confirm
- [ ] Remove all references without litter

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
