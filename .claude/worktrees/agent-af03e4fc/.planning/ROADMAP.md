# Roadmap: Costco Receipts — Rate Limit Resilience Milestone

## Overview

The existing tool fetches receipts but breaks under rate limiting because it uses raw fetch with no retry logic and a fixed 500ms delay. This milestone adds two capabilities in dependency order: first, a resilient HTTP layer that retries correctly and classifies errors so 401/403 halt immediately; second, a checkpoint-aware pipeline so interrupted fetches resume rather than restart from scratch. After both phases, the tool can reliably fetch a full Costco receipt history end-to-end.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: HTTP Resilience** - Replace raw fetch with retry-aware HTTP layer that classifies errors and backs off correctly
- [ ] **Phase 2: Checkpoint and Resume** - Add checkpoint file so interrupted fetches resume from where they left off

## Phase Details

### Phase 1: HTTP Resilience
**Goal**: The tool retries failed requests intelligently and halts immediately on unrecoverable errors
**Depends on**: Nothing (first phase)
**Requirements**: RETRY-01, RETRY-02, RETRY-03, RETRY-04, RETRY-05, UX-02
**Success Criteria** (what must be TRUE):
  1. A 429 response causes the tool to wait and retry (up to 5 attempts) rather than failing immediately
  2. When the Costco API returns a Retry-After header, the tool waits exactly that duration before retrying
  3. A 401 response causes the tool to stop immediately and print a message telling the user to refresh their auth token
  4. A 400 or 404 response skips that request without retrying
  5. Each retry attempt prints the wait duration and attempt count (e.g., `Rate limited, retrying in 8.3s (attempt 2/5)`)
**Plans:** 2 plans

Plans:
- [x] 01-01-PLAN.md — Create resilient HTTP layer (ky instance, error classes, tests)
- [ ] 01-02-PLAN.md — Wire ky into costco.ts and add auth error handling to index.ts

### Phase 2: Checkpoint and Resume
**Goal**: The tool tracks fetch progress to disk so any interruption can be resumed without re-fetching receipts already retrieved
**Depends on**: Phase 1
**Requirements**: RESL-01, RESL-02, RESL-03, RESL-04, UX-01, UX-03
**Success Criteria** (what must be TRUE):
  1. Re-running the tool after a partial fetch skips receipts already retrieved in the previous run
  2. Pressing Ctrl+C during a fetch saves progress and exits cleanly; the next run resumes from the checkpoint
  3. The tool displays a live counter during fetch (e.g., `[12/47] Fetching receipt...`)
  4. On completion, the tool prints a summary showing total fetched, skipped, and failed counts
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. HTTP Resilience | 0/2 | Not started | - |
| 2. Checkpoint and Resume | 0/? | Not started | - |
