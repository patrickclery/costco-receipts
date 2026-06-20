---
phase: 01-http-resilience
plan: 01
subsystem: api
tags: [ky, http, retry, backoff, rate-limiting, error-classification]

# Dependency graph
requires: []
provides:
  - "Resilient ky HTTP instance (costcoApi) with 5-retry, POST-enabled, transient-status-only retry policy"
  - "CostcoAuthError class for 401 responses with actionable token refresh instructions"
  - "CostcoPermanentError class for 400/403/404 responses with status and response body"
  - "interRequestDelay utility (3s + jitter) for rate limit prevention"
affects: [01-02, costco-wiring, pipeline]

# Tech tracking
tech-stack:
  added: [ky@1.14.3]
  patterns: [ky.create-shared-instance, custom-error-classes, beforeRetry-logging-hook, beforeError-classification-hook]

key-files:
  created: [src/http.ts, src/http.test.ts]
  modified: [package.json, package-lock.json]

key-decisions:
  - "Used node --import tsx (not tsx/esm) as test loader to avoid ESM cycle error with node:test"
  - "Used node:test built-in test runner with node:assert -- no extra test framework dependencies"
  - "backoffLimit set to 60_000 per D-05, not 30_000 from STACK.md recommendation"

patterns-established:
  - "Error classification pattern: 401 -> CostcoAuthError, 400/403/404 -> CostcoPermanentError, transient -> ky retry"
  - "beforeRetry hook pattern: log retry count and approximate wait duration to console"
  - "interRequestDelay pattern: base delay + random jitter for proactive rate limit avoidance"
  - "Test pattern: node:test + tsx loader, tests colocated as *.test.ts"

requirements-completed: [RETRY-01, RETRY-02, RETRY-03, RETRY-05, UX-02]

# Metrics
duration: 2min
completed: 2026-03-23
---

# Phase 01 Plan 01: HTTP Resilience Layer Summary

**Resilient ky HTTP instance with 5-retry exponential backoff, error classification (401/permanent/transient), and 3s inter-request delay utility**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-23T01:15:14Z
- **Completed:** 2026-03-23T01:17:21Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Installed ky@1.14.3 and created a shared ky instance with retry config targeting POST on transient status codes (408, 429, 500, 502, 503, 504) up to 5 attempts with 60s backoff cap
- Built error classification: 401 throws CostcoAuthError with step-by-step token refresh instructions, 400/403/404 throw CostcoPermanentError with status and body
- Created interRequestDelay utility (3000ms base + 0-1000ms jitter) for proactive rate limit avoidance
- Added test suite with 14 passing tests using node:test built-in (zero new test dependencies)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install ky and create src/http.ts** - `3672a0b` (feat)
2. **Task 2: Create src/http.test.ts with tests** - `47b492c` (test)

## Files Created/Modified

- `src/http.ts` - Resilient ky instance, CostcoAuthError, CostcoPermanentError, interRequestDelay, INTER_REQUEST_DELAY_MS
- `src/http.test.ts` - 14 tests covering error classes, config, delay utility
- `package.json` - Added ky dependency, test script
- `package-lock.json` - Updated lockfile with ky

## Decisions Made

- Used `node --import tsx` (not `tsx/esm`) as the test loader because `tsx/esm` causes an `ERR_REQUIRE_CYCLE_MODULE` error with node:test on Node 22
- Used node:test built-in test runner with node:assert/strict -- no extra test framework dependencies needed
- Set backoffLimit to 60,000ms per D-05 context decision (overriding STACK.md's 30,000ms suggestion)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed test runner loader from tsx/esm to tsx**
- **Found during:** Task 2 (test creation)
- **Issue:** `node --import tsx/esm --test` causes `ERR_REQUIRE_CYCLE_MODULE` on Node 22.22.1 when loading test files that import ESM packages
- **Fix:** Changed test script to `node --import tsx --test` which properly registers the tsx loader without the ESM cycle issue
- **Files modified:** package.json
- **Verification:** All 14 tests pass with `npm test`
- **Committed in:** 47b492c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Loader fix was necessary for tests to run. No scope creep.

## Issues Encountered

None beyond the test loader deviation documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- src/http.ts is ready for Plan 02 to wire into costco.ts, replacing raw fetch calls with costcoApi
- Error classes (CostcoAuthError, CostcoPermanentError) are ready for error handling in the fetch pipeline
- interRequestDelay is ready to replace the existing sleep(500) calls

---
*Phase: 01-http-resilience*
*Completed: 2026-03-23*
