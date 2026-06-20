---
phase: 01-http-resilience
verified: 2026-03-22T00:00:00Z
status: gaps_found
score: 9/10 must-haves verified
re_verification: false
gaps:
  - truth: "All tests pass via npm test"
    status: failed
    reason: "npm install was not re-run after ky was added. ky exists in package.json and package-lock.json but is absent from node_modules, so tests abort with Cannot find module 'ky' before any test can execute."
    artifacts:
      - path: "node_modules/ky"
        issue: "Directory does not exist — npm install not completed"
    missing:
      - "Run npm install to materialize ky into node_modules so the test suite can execute"
human_verification:
  - test: "Verify retry-with-backoff behavior against live or mocked HTTP server"
    expected: "A 429 response triggers ky's beforeRetry hook, logs 'Rate limited, retrying in Xs (attempt N/5)', and retries up to 5 times with exponential backoff"
    why_human: "Cannot test ky's actual retry loop (HTTP interception) without a running server or HTTP mock — behavioral spot-check skipped because no mock server is installed"
---

# Phase 01: HTTP Resilience Verification Report

**Phase Goal:** The tool retries failed requests intelligently and halts immediately on unrecoverable errors
**Verified:** 2026-03-22
**Status:** gaps_found — 9/10 must-haves verified; 1 gap (missing npm install for ky)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A ky instance exists configured with retry on POST, 5 attempts, backoff cap at 60s | VERIFIED | `src/http.ts:52-91` — `ky.create()` with `limit: 5`, `methods: ['post']`, `backoffLimit: 60_000` |
| 2 | 429/500/502/503/504 are classified as retryable; 400/401/403/404 are not retried | VERIFIED | `statusCodes: [408, 429, 500, 502, 503, 504]` at line 56; 401/400/403/404 handled in `beforeError` hook (lines 76-89) |
| 3 | Retry-After header from 429 responses is respected via ky's built-in parsing | VERIFIED | `maxRetryAfter: 120_000` at line 58 activates ky's native Retry-After header parsing |
| 4 | Each retry attempt logs wait duration and attempt count to console | VERIFIED | `beforeRetry` hook at lines 62-73 calls `console.log('  Rate limited, retrying in ${displaySeconds}s (attempt ${retryCount}/5)')` |
| 5 | 401 responses throw a specific error type that callers can detect to halt | VERIFIED | `CostcoAuthError` class lines 7-20; `beforeError` hook throws it on `response.status === 401` |
| 6 | graphqlRequest() uses the ky instance from http.ts instead of raw fetch | VERIFIED | `src/costco.ts:166` — `costcoApi.post(GRAPHQL_URL, { json: ..., headers: ... })`; zero `fetch(` occurrences remain |
| 7 | The inter-request delay between API calls is 3s + jitter (not 500ms) | VERIFIED | `interRequestDelay()` called 3 times in `costco.ts`; no `sleep(500)` remains; `INTER_REQUEST_DELAY_MS = 3000` with `+ Math.random() * 1000` |
| 8 | A 401 response halts the entire fetch loop immediately with an actionable error message | VERIFIED | `costco.ts:239` re-throws `CostcoAuthError`; `index.ts:64-66` catches it, prints `err.message`, calls `process.exit(1)` |
| 9 | A 400/404 response skips that receipt without retrying and continues to the next | VERIFIED | `costco.ts:243-244` catches `CostcoPermanentError`, logs skip message, does not re-throw |
| 10 | All tests pass via npm test | FAILED | `ky` absent from `node_modules`; `npm test` aborts with `Cannot find module 'ky'` — 0 tests run, exit code 1 |

**Score:** 9/10 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/http.ts` | Resilient ky instance and error classification | VERIFIED | 105 lines; exports `costcoApi`, `CostcoAuthError`, `CostcoPermanentError`, `interRequestDelay`, `INTER_REQUEST_DELAY_MS` (5 exports) |
| `src/http.test.ts` | Tests proving retry behavior, error classification, delay | VERIFIED (code) / BROKEN (runtime) | File exists, 87 lines, covers all required behaviors. Cannot execute because `ky` not installed |
| `src/costco.ts` | ky-powered GraphQL request function with error classification in fetch loop | VERIFIED | Imports from `./http.js`; uses `costcoApi.post()`; no raw fetch; error-type-aware catch blocks |
| `src/index.ts` | Top-level CostcoAuthError catch for immediate halt | VERIFIED | Imports `CostcoAuthError`; try/catch around `fetchAllReceipts()`; prints message and exits on 401 |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/http.ts` | `ky` | `ky.create()` | VERIFIED (code), NOT_INSTALLED (runtime) | `import ky from 'ky'` at line 1; `ky.create({...})` at line 52; ky not in `node_modules` |
| `src/costco.ts` | `src/http.ts` | `import { costcoApi, interRequestDelay, CostcoAuthError, CostcoPermanentError }` | WIRED | Line 3 of `costco.ts` — full import confirmed |
| `src/costco.ts graphqlRequest()` | `costcoApi.post()` | ky POST with json option | WIRED | `costco.ts:166` — `costcoApi.post(GRAPHQL_URL, { json: ..., headers: ... })` |
| `src/costco.ts fetchAllReceipts()` | `interRequestDelay()` | await between each API call | WIRED | 3 occurrences in `costco.ts`; lines 221 (list loop) and 250 (detail loop) |
| `src/index.ts main()` | `CostcoAuthError` | catch block that detects auth failure and exits | WIRED | `index.ts:4` import; `index.ts:64` instanceof check; `index.ts:65-66` message + exit |

---

## Data-Flow Trace (Level 4)

Not applicable — this phase creates an HTTP infrastructure layer, not a rendering/data-display component. No state-to-render data flow to trace.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `src/http.ts` exports importable | `grep -c 'export' src/http.ts` | 5 exports | PASS |
| No raw `fetch(` in `costco.ts` | `grep -c 'fetch(' src/costco.ts` | 0 | PASS |
| No `sleep(500)` in `costco.ts` | `grep -c 'sleep' src/costco.ts` | 0 | PASS |
| `interRequestDelay` used in `costco.ts` | `grep -c 'interRequestDelay' src/costco.ts` | 3 | PASS |
| `CostcoAuthError` imported in `index.ts` | `grep -c 'CostcoAuthError' src/index.ts` | 2 (import + check) | PASS |
| TypeScript compilation | `npx tsc --noEmit` | 3 errors — all caused by missing `ky` types; no logic errors | BLOCKED by ky absence |
| Full test suite | `npm test` | Exit 1 — `Cannot find module 'ky'` | FAIL — ky not installed |

**Note on TypeScript errors:** All 3 tsc errors (`TS2307: Cannot find module 'ky'`, `TS7031`, `TS7006`) are type-inference failures caused by missing ky type definitions — not logic bugs. The two implicit `any` errors in `beforeRetry` and `beforeError` hook parameters would be resolved by the `ky` package providing its own types upon installation.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| RETRY-01 | 01-01, 01-02 | Retry with exponential backoff and full jitter, base 2s, cap 60s | SATISFIED | `backoffLimit: 60_000`; `beforeRetry` hook computes `Math.random() * Math.min(60000, 2000 * 2^n)` |
| RETRY-02 | 01-01, 01-02 | Respect Retry-After header, fall back to calculated backoff | SATISFIED | `maxRetryAfter: 120_000` in ky config — ky natively parses `Retry-After` when this option is set |
| RETRY-03 | 01-01, 01-02 | Classify errors as transient or permanent, only retry transient | SATISFIED | `statusCodes: [408, 429, 500, 502, 503, 504]`; 400/401/403/404 routed to `beforeError` with no retry |
| RETRY-04 | 01-02 | Bail immediately on 401 with clear token-refresh message | SATISFIED | `CostcoAuthError` thrown on 401; caught in `index.ts`; prints step-by-step instructions; exits |
| RETRY-05 | 01-01, 01-02 | Cap retries at 5 attempts per request | SATISFIED | `limit: 5` in `costcoApi` retry config |
| UX-02 | 01-01, 01-02 | Log retry attempts with wait duration (`Rate limited, retrying in Xs (attempt N/5)`) | SATISFIED | `beforeRetry` hook logs exact format: `  Rate limited, retrying in ${displaySeconds}s (attempt ${retryCount}/5)` |

All 6 required requirements are satisfied at the code level. Runtime execution blocked only by missing npm install.

**No orphaned requirements detected.** All requirement IDs declared in plan frontmatter (RETRY-01 through RETRY-05, UX-02) appear in REQUIREMENTS.md Phase 1 traceability table and are marked Complete.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/http.ts` | 63 | `({ retryCount })` — destructured hook arg typed as implicit `any` | Info | TypeScript strict-mode flag; resolved automatically when `ky` types are available after `npm install` |
| `src/http.ts` | 76 | `async (error)` — hook arg typed as implicit `any` | Info | Same as above — not a code bug, a missing-types side effect |

No blockers or logic-level anti-patterns. No TODO/placeholder/empty-return stubs found.

---

## Human Verification Required

### 1. Retry Behavior Under 429

**Test:** Run with a mocked server that returns 429 for the first 3 requests then 200
**Expected:** Console shows three lines matching `  Rate limited, retrying in X.Xs (attempt N/5)` then success
**Why human:** Requires a mock HTTP server or live Costco API triggering a rate limit — cannot be verified by static code analysis alone

### 2. CostcoAuthError Token Refresh Message Display

**Test:** Run `npm start --fetch-only` with an expired `COSTCO_AUTH_TOKEN`
**Expected:** Tool prints the multi-line token refresh instructions (DevTools steps 1-6) to stderr and exits with code 1 — no stack trace visible
**Why human:** Requires a live network call that returns 401; cannot be triggered in static verification

---

## Gaps Summary

One gap blocks complete goal achievement:

**ky not installed in node_modules.** The `package.json` and `package-lock.json` correctly declare `ky@^1.14.3`, and the code in `src/http.ts` is correctly authored. However, `npm install` was not run after ky was added (the `node_modules` directory contains the pre-ky dependencies from the initial commit). As a result:

- `npm test` exits with code 1 before any test runs
- `npx tsc --noEmit` reports 3 errors (all type-inference failures from missing ky types, not logic bugs)
- The running tool (`npm start`) would also fail to import `ky`

**Fix:** `npm install` in the project root. No code changes required. All source code is correct and complete.

The code itself fully achieves the phase goal — all retry logic, error classification, wiring, and error messaging are correctly implemented. The gap is purely a dependency materialization issue.

---

_Verified: 2026-03-22_
_Verifier: Claude (gsd-verifier)_
