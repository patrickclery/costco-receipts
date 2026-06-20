# Project Research Summary

**Project:** Costco Receipt Importer — Rate Limit Resilience Milestone
**Domain:** Resilient rate-limited API consumer CLI / receipt data pipeline
**Researched:** 2026-03-22
**Confidence:** HIGH

## Executive Summary

This project is a Node.js/TypeScript CLI tool that fetches Costco purchase receipts from an undocumented private GraphQL API and imports them into Actual Budget. The current implementation fails under rate limiting because it uses raw `fetch` with no retry logic and a fixed 500ms delay between requests. The research consensus is clear: replace raw `fetch` with `ky` (which handles exponential backoff, Retry-After header parsing, and 429/5xx retry out of the box), increase the inter-request delay to 1.5–2 seconds with jitter, and add a checkpoint file system so interrupted fetches resume rather than restart from scratch.

The recommended architecture adds two new modules (`src/http.ts` for resilient HTTP, `src/pipeline.ts` for checkpoint-aware orchestration) alongside a small `src/checkpoint.ts` file, without restructuring the existing three-layer design. The existing `costco.ts` shrinks to GraphQL queries and header construction; the new pipeline layer owns the fetch loop with checkpoint awareness. This is a targeted, additive refactor — no existing interfaces change for downstream consumers.

The primary risk is Costco's Akamai bot protection, which can escalate from 429 (rate limit, recoverable) to 403 (account block, hard to recover from). Conservative defaults — 2-second minimum spacing with random jitter, immediate halt on 401 and 403, a 5-retry maximum per request — are non-negotiable. The 500ms baseline in the current code is demonstrably too aggressive. Build conservative from the start; tuning upward later is safe, tuning downward after a block is not.

## Key Findings

### Recommended Stack

The only new dependency required is `ky@1.14.3` — a zero-dependency HTTP client that wraps native fetch with built-in exponential backoff, Retry-After header parsing, configurable retry methods (POST must be opted in for GraphQL), and TypeScript types bundled. It is ESM-only and requires Node >= 18; the project runs Node 22.22.1 via `tsx`, which handles ESM-only packages correctly without `"type": "module"`. The `graphqlRequest()` function shrinks from 14 lines to approximately 3 once it delegates to a `ky` instance configured with the project's retry policy.

`p-retry@7.1.1` is available if non-HTTP retry is later needed (e.g., Actual Budget connection retries), but is not needed for this milestone. No concurrency-control library (`p-queue`, `p-throttle`, `bottleneck`) is warranted because requests are already sequential.

**Core technologies:**
- `ky@1.14.3`: HTTP client — zero-dependency fetch wrapper with built-in retry, Retry-After parsing, and TypeScript types; replaces raw fetch with a single library that solves the entire retry problem
- `sleep()` utility (already in project): inter-request throttle — increase from 500ms to 1500-2000ms + `Math.random() * 1000ms` to prevent triggering Akamai bot detection
- `tsx@4.21.0` (already in project): ESM runner — handles ky's ESM-only requirement transparently

### Expected Features

Six features constitute the minimum for this milestone. All are classified HIGH user value and LOW-MEDIUM implementation cost, making them P1 with no deferral justification.

**Must have (table stakes):**
- Exponential backoff with full jitter on 429/5xx — without it, retries hammer the server at the same rate and worsen the problem
- Retry-After header respect — the server specifies the correct wait; ignoring it risks escalation to account block
- Max retry limit with error classification — 401/403/400 must never retry; 429/5xx/network must retry; cap at 4-5 retries maximum
- Resume interrupted fetches (checkpoint) — the current code loses all progress on any interruption; this is the core reliability gap
- Graceful shutdown on SIGINT — Ctrl+C must save checkpoint before exit
- Progress reporting with counters — during backoff waits, silence looks like a frozen tool; the user kills the process and loses progress

**Should have (add in next milestone):**
- Date range filtering (`--since`, `--until`) — reduces API calls on subsequent runs
- Configurable delay (`--delay <ms>`) — escape hatch for users who observe different rate limit tolerances
- Verbose/quiet logging levels — useful for diagnosing rate limit issues
- Dry-run mode — preview receipt count before committing to a long fetch

**Defer (v2+):**
- Token expiry early warning (enhanced messaging exists in scope but dedicated detection can wait)
- Date-based incremental sync (after initial full history import completes)

**Explicitly not building:**
- Parallel/concurrent fetching — counterproductive against a rate-limited private API
- Automatic token refresh — requires headless browser, fragile, potential ToS violation
- Database storage — JSON files are sufficient for a single-user CLI
- Proxy rotation — ethically problematic for accessing your own purchase data

### Architecture Approach

The existing three-layer architecture (CLI orchestration, API integration, data model) is sound and requires no restructuring. New functionality slots into the API integration layer as two new modules. The key refactor is splitting the current `fetchAllReceipts()` function in `costco.ts`, which conflates iteration, HTTP communication, and error handling — the natural seam for adding retry logic and checkpoint persistence. `costco.ts` retains only GraphQL query strings, `buildHeaders()`, and thin wrappers for list and detail fetches; all HTTP resilience moves to `http.ts`.

**Major components:**
1. `src/http.ts` (NEW) — Resilient HTTP layer: ky client instance with retry config, Retry-After parsing, request spacing; generic, knows nothing about receipts
2. `src/pipeline.ts` (NEW) — Fetch pipeline: checkpoint-aware orchestration loop replacing `fetchAllReceipts()`; owns "what to fetch next" decisions
3. `src/checkpoint.ts` (NEW) — Checkpoint manager: atomic read/write/delete of `.costco-fetch-checkpoint.json`; dedicated file keeps state persistence testable in isolation
4. `src/costco.ts` (SLIMMED) — GraphQL queries and headers only; delegates HTTP calls through `http.ts`
5. `src/index.ts` (MINOR CHANGE) — Replaces `fetchAllReceipts()` call with pipeline invocation; adds `--force-refetch` flag

Build order matters: `http.ts` first (no dependencies), then `costco.ts` wired to it (immediate retry value), then `checkpoint.ts` (pure file I/O, independently testable), then `pipeline.ts` (composes the above).

### Critical Pitfalls

1. **Retrying on every error type equally** — 401 (expired token) and 403 (account block) must cause immediate halt with clear user message, not retry. Retrying 401 wastes minutes and delays the user from getting actionable information. Solution: classify errors before entering any retry loop; `ky` configuration uses `statusCodes` to control which codes trigger retry.

2. **500ms inter-request delay triggers bot detection** — Costco uses Akamai bot protection. The current 500ms fixed delay is too aggressive for a private API and can escalate from rate limiting (429, recoverable) to account block (403, requires 24-48 hour wait). Solution: minimum 2 seconds between requests, plus `Math.random() * 1000ms` jitter to avoid machine-like timing regularity.

3. **No jitter in exponential backoff creates retry storms** — Pure `baseDelay * 2^attempt` is deterministic; multiple requests that hit 429 simultaneously all retry at the same moment, immediately triggering another 429 wave. Solution: full jitter — `Math.random() * min(cap, baseDelay * 2^attempt)`.

4. **No checkpoint causes complete re-fetch after any interruption** — The current code writes output only after the entire fetch completes. Rate limit mid-run, token expiry, or Ctrl+C loses everything. Solution: write checkpoint after each successful receipt detail fetch; load on startup and skip fetched barcodes.

5. **Unbounded retries with no user feedback looks like a frozen tool** — Without a cap and without progress output during waits, the CLI appears hung. Users kill the process, losing progress. Solution: cap at 4 retries per request, 30 seconds maximum delay, and print countdown during waits: `"Rate limited. Retrying in 12s (attempt 2/4)..."`.

## Implications for Roadmap

Based on research, a two-phase structure is recommended. All pitfalls in Phase 1 are flagged as "must be in place before any large-scale fetching is attempted" — they are not incremental polish, they are preconditions for safe use of the tool.

### Phase 1: Core Resilience — HTTP Retry and Error Classification

**Rationale:** All Phase 2 features depend on reliable HTTP behavior. Checkpoint/resume is only valuable if the HTTP layer correctly distinguishes retryable from permanent errors; otherwise checkpointing a failed-token run just resumes a run that will fail again immediately. PITFALLS.md explicitly maps Pitfalls 1, 2, 3, 4, 6, and 7 to Phase 1 — six of seven critical pitfalls are Phase 1 concerns.

**Delivers:**
- `src/http.ts` with ky instance, retry config for POST, exponential backoff with full jitter, Retry-After header parsing
- Error classification: 429/5xx/network retried; 401/403 cause immediate halt with actionable message; 400/404 log and skip
- `costco.ts` wired to use `http.ts` instead of raw `fetch()`, replacing hardcoded `sleep(500)` with configurable spacing at 1500-2000ms + jitter
- Retry progress output: `"Rate limited. Retrying in 12s (attempt 2/4)..."`
- Per-receipt fetch counter: `[12/47] Fetching receipt: 2025-06-15 ($234.56)...`
- Conservative defaults: 2s base delay, 30s max delay, 4-5 retries maximum, 403 causes immediate stop

**Addresses features:** Exponential backoff with jitter, Retry-After header respect, max retry limit, error classification, progress reporting with counters

**Avoids pitfalls:** Pitfall 1 (equal error treatment), Pitfall 2 (no jitter), Pitfall 3 (token expiry undetected), Pitfall 4 (account block from aggressive timing), Pitfall 6 (unbounded retries), Pitfall 7 (ignoring Retry-After)

### Phase 2: Checkpoint and Resume

**Rationale:** Checkpoint depends on Phase 1 being stable — a checkpoint that resumes into a broken HTTP layer is worse than no checkpoint (it creates false confidence). Once retry is working, interrupted fetches are the next failure mode. ARCHITECTURE.md is explicit that the checkpoint file is simpler and more reliable than inferring state from the output JSON file.

**Delivers:**
- `src/checkpoint.ts` with atomic write (write to temp file, rename), load, and delete operations
- `FetchCheckpoint` type with `fetchedBarcodes`, `summaries`, `details`, `listPhaseComplete`, timestamps
- `src/pipeline.ts` replacing `fetchAllReceipts()`: checkpoint-aware list phase and detail phase, incremental checkpoint write after each receipt, graceful failure for permanently-failed receipts
- `src/index.ts` updated: `runFetchPipeline()` replaces `fetchAllReceipts()`, `--force-refetch` flag to ignore existing checkpoint
- SIGINT/SIGTERM handler: saves checkpoint before exit
- End-of-run summary: `"Completed: 170/200 receipts. 30 failed. Re-run to retry."`

**Addresses features:** Resume interrupted fetches, graceful shutdown on SIGINT

**Avoids pitfalls:** Pitfall 5 (no checkpoint), and closes the UX pitfalls around silent failure and Ctrl+C data loss

**Uses stack:** `ky` from Phase 1, `checkpoint.ts` pure Node.js file I/O

**Implements architecture:** Checkpoint Manager, Fetch Pipeline (from ARCHITECTURE.md build order Steps 3-5)

### Phase 3: Ergonomic Improvements (Next Milestone)

**Rationale:** Once core resilience and resume are working and validated against real Costco API behavior, P2 features become worthwhile. These are independent of each other and can be prioritized by observed user pain.

**Delivers:**
- Date range filtering (`--since`, `--until`) — reduces API calls on subsequent incremental runs
- Configurable delay (`--delay <ms>`) — per-user tuning escape hatch
- Verbose/quiet logging levels (`--verbose`, `--quiet`)
- Dry-run mode (`--dry-run`) — fetches summary only, shows count and date range, exits

**Addresses features:** All P2 features from FEATURES.md

### Phase Ordering Rationale

- Phase 1 before Phase 2 because checkpoint resume is only safe if the underlying HTTP layer correctly classifies errors — resuming with broken error handling compounds the problem
- Phase 1 before Phase 2 because ARCHITECTURE.md's build order explicitly sequences HTTP layer (Step 1) → costco.ts wiring (Step 2) → checkpoint (Step 3) → pipeline (Step 4)
- Phase 3 deferred because P2 features add ergonomics but the tool is already useful and safe after Phase 2; date range filtering is only valuable after the full history is imported once
- Conservative timing defaults must be set in Phase 1, not tuned later — starting aggressive and loosening after a block is not possible if the account is flagged

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** Costco-specific Akamai behavior is MEDIUM confidence (documented patterns from web scraping domain, but no direct observation of this specific API's bot detection thresholds). Before finalizing delay values, run a manual timing test against the real API. The `client-identifier` header uses `randomUUID()` per request — unknown whether Costco expects session-consistent or per-request identifiers; this needs testing.
- **Phase 2:** Atomic file write behavior on Windows (if cross-platform support matters) — write-then-rename is atomic on POSIX but not guaranteed on Windows NTFS.

Phases with standard patterns (skip research):
- **Phase 1 (retry/backoff implementation):** Well-documented, AWS and industry consensus on full jitter formula. `ky` handles the implementation; no novel engineering required.
- **Phase 2 (checkpoint file pattern):** Standard pipeline checkpoint pattern; ARCHITECTURE.md provides complete data structure and lifecycle.
- **Phase 3:** All features are straightforward CLI argument additions with standard patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | `ky` version verified via `npm view`; ESM/Node compatibility confirmed; zero-dependency status verified. Clear winner over alternatives. |
| Features | HIGH | Feature set derived from authoritative sources (AWS, OpenAI Cookbook, web scraping research). P1/P2/P3 classification is well-reasoned with explicit dependency chain. |
| Architecture | HIGH | Build order and component boundaries derived from existing codebase analysis. Anti-patterns are well-documented. No speculative components. |
| Pitfalls | HIGH (general) / MEDIUM (Costco-specific) | Retry/backoff/checkpoint pitfalls are well-established. Costco's specific Akamai configuration, rate limit thresholds, and `client-identifier` expectations are inferred from patterns, not direct documentation. |

**Overall confidence:** HIGH for implementation approach. MEDIUM for exact timing parameters (2s vs 1.5s vs 3s base delay) — these need validation against the real API.

### Gaps to Address

- **Costco's Retry-After header behavior:** Unknown whether Costco's API sends `Retry-After` on 429 responses. STACK.md's `maxRetryAfter: 120_000` cap handles the case if it does; exponential backoff handles the case if it doesn't. Implement defensively; observe in practice.
- **`client-identifier` header consistency:** `buildHeaders()` currently calls `randomUUID()` per request. Unknown whether Costco expects the same identifier throughout a session. If per-session consistency is expected, a new UUID per request could trigger bot detection. Validate by observing whether existing requests succeed with the current behavior before changing anything.
- **Actual Budget import batch size:** PITFALLS.md flags that importing 500+ transactions with subtransactions may overwhelm Actual's SQLite backend. This is outside the scope of the current milestone but should be investigated before Phase 3 if large histories are being imported.
- **Token lifetime:** Estimated 15-60 minutes based on typical OAuth patterns but not confirmed for Costco. The probe-request approach (fetch one day's summaries before starting a long batch) validates the token without revealing its actual lifetime.

## Sources

### Primary (HIGH confidence)
- [ky GitHub repository](https://github.com/sindresorhus/ky) — retry options, Retry-After handling, zero-dep confirmation, POST opt-in
- [p-retry GitHub repository](https://github.com/sindresorhus/p-retry) — API, options, backoff strategy
- [AWS Builders' Library: Timeouts, retries and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) — production retry best practices, full jitter rationale
- [AWS Architecture Blog: Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — full vs decorrelated jitter performance comparison
- `npm view ky version engines type` — version 1.14.3, Node >= 18, ESM only (local verification)
- `npm view p-retry version engines type` — version 7.1.1, Node >= 20, ESM only (local verification)
- [MDN: 429 Too Many Requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429) — Retry-After header specification
- Codebase analysis: `src/costco.ts`, `src/index.ts`, `src/actual.ts`, `.planning/codebase/CONCERNS.md`

### Secondary (MEDIUM confidence)
- [OpenAI Cookbook: How to handle rate limits](https://cookbook.openai.com/examples/how_to_handle_rate_limits) — practical examples
- [The Web Scraping Club: Dealing with Rate Limiting Using Exponential Backoff](https://substack.thewebscraping.club/p/rate-limit-scraping-exponential-backoff) — private API patterns
- [Stop Getting Blocked: 10 Common Web-Scraping Mistakes - Firecrawl](https://www.firecrawl.dev/blog/web-scraping-mistakes-and-fixes) — Akamai bot detection patterns
- [Better Stack: Mastering Exponential Backoff](https://betterstack.com/community/guides/monitoring/exponential-backoff/) — jitter strategy comparison
- [OneUptime: Building Graceful Shutdown Handler in Node.js](https://oneuptime.com/blog/post/2026-01-06-nodejs-graceful-shutdown-handler/view) — SIGINT/SIGTERM patterns
- [How to Implement Retry Logic with Exponential Backoff in Node.js](https://oneuptime.com/blog/post/2026-01-06-nodejs-retry-exponential-backoff/view)

### Tertiary (LOW confidence)
- [How to Handle API Rate Limits Gracefully (2026 Guide)](https://apistatuscheck.com/blog/how-to-handle-api-rate-limits) — general patterns (Costco-specific behavior not documented anywhere publicly)

---
*Research completed: 2026-03-22*
*Ready for roadmap: yes*
