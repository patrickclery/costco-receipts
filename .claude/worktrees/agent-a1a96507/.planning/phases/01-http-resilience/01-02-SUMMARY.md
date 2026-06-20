---
phase: 01-http-resilience
plan: 02
subsystem: api
tags: [ky, http, retry, error-handling, graphql, rate-limiting]

# Dependency graph
requires:
  - phase: 01-http-resilience plan 01
    provides: "costcoApi ky instance, CostcoAuthError, CostcoPermanentError, interRequestDelay"
provides:
  - "ky-powered GraphQL requests with automatic retry on transient errors"
  - "Error classification in fetch loop: auth halt, permanent skip, transient retry"
  - "Top-level CostcoAuthError catch with actionable message and clean exit"
  - "3s + jitter inter-request delay replacing 500ms fixed delay"
affects: [02-checkpoint-resume]

# Tech tracking
tech-stack:
  added: []
  patterns: ["error-type-aware catch blocks with instanceof checks", "ky post with json option for GraphQL"]

key-files:
  created: []
  modified:
    - src/costco.ts
    - src/index.ts

key-decisions:
  - "Used costcoApi.post() with json option instead of raw fetch with JSON.stringify"
  - "CostcoAuthError re-thrown from detail loop to propagate to index.ts for clean halt"
  - "CostcoPermanentError logged and skipped per receipt, not halting entire fetch"

patterns-established:
  - "Error classification pattern: CostcoAuthError = halt, CostcoPermanentError = skip, other = log and continue"
  - "interRequestDelay() used between all sequential API calls"

requirements-completed: [RETRY-01, RETRY-02, RETRY-03, RETRY-04, RETRY-05, UX-02]

# Metrics
duration: 2min
completed: 2026-03-23
---

# Phase 01 Plan 02: HTTP Wiring Summary

**Replaced raw fetch with ky-powered GraphQL client adding automatic retry, error classification, and 3s+jitter rate limiting to Costco API calls**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-23T01:20:22Z
- **Completed:** 2026-03-23T01:22:59Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Replaced raw fetch() with costcoApi.post() in graphqlRequest() for automatic retry on 429/5xx errors
- Added error-type-aware catch blocks: CostcoAuthError halts fetch, CostcoPermanentError skips receipt, transient errors log and continue
- Changed inter-request delay from fixed 500ms to 3s + random jitter (0-1000ms) via interRequestDelay()
- Added top-level CostcoAuthError handler in index.ts that prints token-refresh instructions and exits cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace raw fetch in graphqlRequest() with ky and update inter-request delays** - `4150573` (feat)
2. **Task 2: Add CostcoAuthError handling to index.ts for clean halt on 401** - `4073272` (feat)

## Files Created/Modified
- `src/costco.ts` - Replaced fetch with costcoApi.post(), removed sleep(), added error classification in detail loop
- `src/index.ts` - Added CostcoAuthError import and try/catch around fetchAllReceipts() for clean 401 handling

## Decisions Made
- Used costcoApi.post() with json option (ky handles JSON.stringify and Content-Type internally, but we pass custom headers via buildHeaders())
- CostcoAuthError thrown from detail loop catch propagates through fetchAllReceipts() to index.ts -- single catch point
- Non-auth errors re-thrown in index.ts so outer main().catch() still handles unexpected failures

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Worktree branch was based on initial commit without http.ts from Plan 01 -- resolved by merging main to get Plan 01 artifacts
- npm dependencies not installed in worktree -- resolved by running npm install

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- HTTP resilience layer fully wired into the Costco API module
- Ready for Phase 02 (checkpoint/resume) to build on the error classification foundation
- All exported function signatures unchanged, so downstream code (index.ts orchestration) works without modification

---
*Phase: 01-http-resilience*
*Completed: 2026-03-23*
