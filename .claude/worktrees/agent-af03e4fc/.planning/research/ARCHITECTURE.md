# Architecture Research

**Domain:** Resilient API consumer pipeline with rate limit handling and resumable fetches
**Researched:** 2026-03-22
**Confidence:** HIGH

## System Overview

The existing three-layer architecture (CLI orchestration, API integration, data model) is sound. Rate limiting and resumption capabilities slot into the **API integration layer** as new components rather than requiring architectural restructuring. The key insight: the current `fetchAllReceipts()` function conflates orchestration, iteration, and API communication. Splitting these concerns creates natural seams for retry logic and checkpoint persistence.

```
┌─────────────────────────────────────────────────────────────┐
│                   CLI Orchestration Layer                     │
│  src/index.ts                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │ CLI Args │  │ File I/O │  │ Progress │                   │
│  │ Parsing  │  │ (JSON)   │  │ Display  │                   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                   │
│       └──────────────┼────────────┘                          │
│                      ↓                                       │
├─────────────────────────────────────────────────────────────┤
│                   Fetch Pipeline Layer (NEW)                  │
│  src/pipeline.ts                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │  Checkpoint  │  │   Receipt    │  │   Receipt    │        │
│  │  Manager     │  │ List Walker  │  │Detail Fetcher│        │
│  │ (state file) │  │ (pagination) │  │  (per-item)  │        │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │
│         └─────────────────┼─────────────────┘                │
│                           ↓                                  │
├─────────────────────────────────────────────────────────────┤
│                Resilient HTTP Layer (NEW)                     │
│  src/http.ts                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   Retry      │  │  Rate Limit  │  │  Request     │        │
│  │   Engine     │  │  Detector    │  │  Queue       │        │
│  │ (backoff)    │  │ (429/headers)│  │ (concurrency)│        │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │
│         └─────────────────┼─────────────────┘                │
│                           ↓                                  │
├─────────────────────────────────────────────────────────────┤
│              External API Integration Layer                   │
│  src/costco.ts (slimmed)    src/actual.ts (unchanged)        │
│  ┌──────────────┐           ┌──────────────┐                 │
│  │  GraphQL     │           │ Actual Budget│                 │
│  │  Queries     │           │   SDK        │                 │
│  │  + Headers   │           │   Wrapper    │                 │
│  └──────────────┘           └──────────────┘                 │
├─────────────────────────────────────────────────────────────┤
│                     Data Model Layer                          │
│  src/types.ts                                                │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │ Receipt  │  │  Checkpoint  │  │  HTTP/Retry  │            │
│  │ Types    │  │  State Type  │  │  Config Type │            │
│  │(existing)│  │   (NEW)      │  │   (NEW)      │            │
│  └──────────┘  └──────────────┘  └──────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Checkpoint Manager** | Persist fetch progress to disk; load on startup to skip completed items | JSON file read/write after each successful fetch |
| **Receipt List Walker** | Iterate through date ranges, collect summaries, track which ranges are done | Loop with checkpoint writes between ranges |
| **Receipt Detail Fetcher** | Fetch individual receipt details, skipping already-fetched barcodes | Iterate receipt list, check checkpoint, fetch missing |
| **Retry Engine** | Wrap fetch calls with exponential backoff + full jitter | Retry loop with configurable max attempts and delay cap |
| **Rate Limit Detector** | Parse 429 status and Retry-After header, detect rate limit patterns | Response interceptor that extracts wait time |
| **Request Queue** | Enforce minimum delay between requests to stay under rate limits | Sequential queue with configurable inter-request delay |

## Recommended Project Structure

```
src/
├── index.ts            # CLI orchestration (exists, minor changes)
├── costco.ts           # GraphQL queries + headers only (slimmed from current)
├── actual.ts           # Actual Budget SDK wrapper (unchanged)
├── types.ts            # All TypeScript interfaces (extended with new types)
├── http.ts             # NEW: Resilient HTTP client (retry, rate limit, queue)
├── pipeline.ts         # NEW: Fetch pipeline with checkpoint management
└── checkpoint.ts       # NEW: Checkpoint file read/write/update
```

### Structure Rationale

- **http.ts:** Isolates all retry/backoff/rate-limit logic from business logic. The existing `graphqlRequest()` function in `costco.ts` currently handles raw HTTP. Moving the resilience wrapper here means `costco.ts` stays focused on GraphQL query definitions and header construction.
- **pipeline.ts:** Extracts the fetch orchestration loop from `fetchAllReceipts()` in `costco.ts`. The current function does three things (iterate date ranges, fetch details, aggregate results) and none of them involve checkpoint awareness. This new file owns the "what to fetch next" decision.
- **checkpoint.ts:** Dedicated checkpoint file management. Small enough to be a single file. Separating it from pipeline.ts keeps the state persistence mechanism testable in isolation.
- **costco.ts stays:** Retains GraphQL query strings, `buildHeaders()`, and thin wrappers like `fetchReceiptList()` and `fetchReceiptDetail()` -- but these now delegate HTTP calls through `http.ts` instead of calling `fetch()` directly.

## Architectural Patterns

### Pattern 1: Exponential Backoff with Full Jitter

**What:** On transient failure (429, 5xx, network error), retry with exponentially increasing delay plus randomization. Full jitter means the actual delay is `random(0, min(cap, base * 2^attempt))`.

**When to use:** Every outbound HTTP request to the Costco API.

**Trade-offs:** Full jitter has slightly longer average completion time than decorrelated jitter but uses significantly less total work (fewer wasted requests). For a single-client CLI tool, this is the right tradeoff -- we care about not getting blocked, not about minimizing p99 latency.

**Why Full Jitter over other approaches:** AWS research demonstrates that full jitter outperforms equal jitter and no-jitter approaches in total work performed. Decorrelated jitter performs comparably but is more complex to implement and its advantage only manifests with many concurrent clients -- irrelevant for a single-user CLI.

**Example:**
```typescript
interface RetryConfig {
  maxRetries: number;     // 5
  baseDelayMs: number;    // 1000
  maxDelayMs: number;     // 60000 (1 minute cap)
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = Math.min(
    config.maxDelayMs,
    config.baseDelayMs * Math.pow(2, attempt)
  );
  // Full jitter: random value between 0 and the exponential delay
  return Math.random() * exponentialDelay;
}
```

### Pattern 2: Checkpoint File for Resumable Fetches

**What:** After each successful atomic unit of work (one receipt detail fetched), append its identifier to a checkpoint file on disk. On startup, load the checkpoint and skip already-fetched items.

**When to use:** The detail-fetch loop, which is the slow, rate-limited part of the pipeline. The list-fetch phase is fast and cheap to repeat.

**Trade-offs:** Adds disk I/O per receipt (negligible for tens/hundreds of items). The checkpoint file is the single source of truth for "what has been fetched" -- simpler than trying to deduce state from the output JSON file, which may be partially written or corrupted.

**Example:**
```typescript
interface FetchCheckpoint {
  startedAt: string;                    // ISO timestamp
  lastUpdatedAt: string;               // ISO timestamp
  listPhaseComplete: boolean;          // true once all summaries collected
  summaries: ReceiptSummary[];         // cached list results
  fetchedBarcodes: string[];           // barcodes already fetched successfully
  details: ReceiptDetail[];            // accumulated detail results
  lastError?: string;                  // last error for diagnostics
}
```

### Pattern 3: Proactive Rate Limiting (Request Spacing)

**What:** Enforce a minimum delay between requests regardless of success/failure, to stay below the API's rate limit threshold. This is preventive, not reactive.

**When to use:** Always. The current code already does `await sleep(500)` between requests. This pattern formalizes it and makes the delay configurable and adaptive.

**Trade-offs:** Slower than firing requests at maximum speed, but dramatically reduces 429 responses. A 1-2 second delay between requests is reasonable for batch-fetching tens of receipts where the total runtime is minutes, not hours.

**Why not p-queue:** The project makes sequential requests to a single endpoint. p-queue's value is concurrency control across parallel requests. With concurrency=1 and a simple delay, a basic sleep-between-requests pattern achieves the same result with zero dependencies. If concurrency needs arise later, p-queue can be added then.

**Example:**
```typescript
async function spacedFetch<T>(
  fn: () => Promise<T>,
  minDelayMs: number = 1500
): Promise<T> {
  const start = Date.now();
  const result = await fn();
  const elapsed = Date.now() - start;
  if (elapsed < minDelayMs) {
    await sleep(minDelayMs - elapsed);
  }
  return result;
}
```

### Pattern 4: Retry-After Header Respect

**What:** When a 429 response includes a `Retry-After` header, use that value as the wait time instead of the calculated backoff. The server is telling you exactly how long to wait.

**When to use:** Whenever receiving a 429 response.

**Trade-offs:** None -- this is strictly better than guessing. The Retry-After header may specify seconds (integer) or an HTTP date. Both must be parsed.

**Example:**
```typescript
function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;

  // Try as seconds first
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds)) return seconds * 1000;

  // Try as HTTP date
  const date = new Date(header);
  if (!isNaN(date.getTime())) return Math.max(0, date.getTime() - Date.now());

  return null;
}
```

## Data Flow

### Resilient Fetch Flow (New)

```
User runs CLI (--fetch-only or default)
    |
    v
Load checkpoint file (if exists)
    |
    +--> Checkpoint found: resume from saved state
    +--> No checkpoint: start fresh
    |
    v
LIST PHASE: Fetch receipt summaries by date range
    |
    +--> For each date range window:
    |      |
    |      v
    |    graphqlRequest() --> Resilient HTTP Layer
    |      |                    |
    |      |                    +--> Apply request spacing (1.5s min)
    |      |                    +--> Send request
    |      |                    +--> On success: return data
    |      |                    +--> On 429: parse Retry-After, wait, retry
    |      |                    +--> On 5xx/network: backoff with jitter, retry
    |      |                    +--> On max retries: throw (pipeline handles)
    |      |
    |      v
    |    Accumulate summaries
    |
    v
Mark listPhaseComplete in checkpoint, save summaries
    |
    v
DETAIL PHASE: Fetch each receipt's full data
    |
    +--> Filter: skip barcodes already in checkpoint.fetchedBarcodes
    |
    +--> For each remaining barcode:
    |      |
    |      v
    |    fetchReceiptDetail(barcode) --> Resilient HTTP Layer
    |      |
    |      v
    |    On success:
    |      - Add detail to checkpoint.details
    |      - Add barcode to checkpoint.fetchedBarcodes
    |      - Write checkpoint to disk (atomic)
    |      |
    |      v
    |    On permanent failure (after max retries):
    |      - Log error with barcode
    |      - Record in checkpoint.lastError
    |      - Continue to next receipt (don't abort entire run)
    |
    v
All receipts fetched (or max-retried)
    |
    v
Write final costco-receipts.json from checkpoint.details
Delete checkpoint file (fetch complete)
    |
    v
Continue to import phase (if --account specified)
```

### Checkpoint File Lifecycle

```
Start fetch
    |
    v
.costco-fetch-checkpoint.json created (or loaded)
    |
    +--> Updated after each successful receipt detail fetch
    +--> Updated when list phase completes
    |
    v
Fetch completes successfully
    |
    v
costco-receipts.json written from checkpoint data
.costco-fetch-checkpoint.json deleted
```

### Key Data Flows

1. **Happy path:** Checkpoint created at start, updated incrementally, deleted on completion. User never sees it.
2. **Interrupted path:** User hits Ctrl+C or rate limit exhausts retries. Checkpoint file persists on disk. Next run detects it, skips already-fetched receipts, continues from where it stopped.
3. **Retry-After path:** HTTP layer detects 429, extracts wait time, pauses pipeline for that duration, then retries the same request. Transparent to the pipeline layer.

## Integration with Existing Code

### What Changes in Existing Files

| File | Change | Scope |
|------|--------|-------|
| `src/costco.ts` | Remove `fetchAllReceipts()` orchestration loop; keep query strings, `buildHeaders()`, `fetchReceiptList()`, `fetchReceiptDetail()`; these two functions call through the new resilient HTTP layer instead of raw `fetch()` | Moderate refactor |
| `src/index.ts` | Replace `fetchAllReceipts()` call with pipeline invocation; add `--resume` / `--force-refetch` flags | Small change |
| `src/types.ts` | Add `FetchCheckpoint`, `RetryConfig`, `RateLimitInfo` interfaces | Additive only |

### What Stays Unchanged

- `src/actual.ts` -- import logic is unaffected by fetch resilience
- GraphQL query strings in `src/costco.ts` -- queries themselves don't change
- `costco-receipts.json` output format -- downstream consumers (import) see no change

## Build Order

This is the critical section for roadmap phasing. Each step builds on the previous and is independently testable.

### Step 1: Resilient HTTP Layer (`src/http.ts`)

**Build first because:** Everything else depends on this. It wraps raw `fetch()` with retry/backoff logic and is self-contained with no dependencies on business logic.

**Delivers:**
- `resilientFetch()` function with exponential backoff + full jitter
- 429 detection with Retry-After header parsing
- Configurable retry count, base delay, max delay
- Transparent to callers -- same interface as `fetch()` but with resilience

**Testable independently:** Call it against a mock server returning 429s and verify retry behavior.

### Step 2: Wire Resilient HTTP into Costco API (`src/costco.ts` refactor)

**Build second because:** Once the HTTP layer exists, the existing `graphqlRequest()` function should delegate to it. This gives immediate value -- the existing pipeline becomes retry-aware without any other changes.

**Delivers:**
- `graphqlRequest()` uses `resilientFetch()` instead of raw `fetch()`
- Request spacing (minimum delay between calls) replaces hardcoded `sleep(500)`
- Existing `fetchAllReceipts()` flow works as before but now survives transient failures

**Testable:** Run the existing CLI and observe retry behavior in logs when rate limited.

### Step 3: Checkpoint Manager (`src/checkpoint.ts`)

**Build third because:** Checkpoint logic is pure file I/O with no network concerns. It can be built and tested independently.

**Delivers:**
- `loadCheckpoint()` -- read and parse checkpoint file, return null if not found
- `saveCheckpoint()` -- atomic write (write to temp file, rename) to prevent corruption
- `deleteCheckpoint()` -- clean up on successful completion
- `FetchCheckpoint` type definition

**Testable independently:** Unit test file read/write/delete/atomic-write behavior.

### Step 4: Fetch Pipeline (`src/pipeline.ts`)

**Build last because:** It composes the resilient HTTP layer and checkpoint manager into the orchestration loop. Requires Steps 1-3 to exist.

**Delivers:**
- `runFetchPipeline()` replacing `fetchAllReceipts()`
- Checkpoint-aware list phase (skip if already done)
- Checkpoint-aware detail phase (skip already-fetched barcodes)
- Incremental checkpoint updates after each receipt
- Graceful handling of permanent failures (skip receipt, continue)
- Clean checkpoint deletion on successful completion

**Testable:** Integration test with mock API that rate-limits and a real checkpoint file.

### Step 5: CLI Integration (`src/index.ts` update)

**Build alongside Step 4:**
- Replace `fetchAllReceipts()` call with `runFetchPipeline()`
- Add `--force-refetch` flag to ignore existing checkpoint
- Add progress output showing "Fetching receipt 5/23 (skipped 4 cached)..."

## Anti-Patterns

### Anti-Pattern 1: Retry at the Wrong Layer

**What people do:** Put retry logic inside `fetchAllReceipts()` alongside business logic, mixing "should I retry this HTTP call?" with "which receipt should I fetch next?"

**Why it's wrong:** Creates untestable coupling. The retry policy becomes entangled with pagination logic. Changing retry behavior requires modifying business logic.

**Do this instead:** Retry at the HTTP layer. `graphqlRequest()` calls `resilientFetch()` which handles retries transparently. The pipeline layer never sees transient failures -- it only sees permanent failures (after all retries exhausted).

### Anti-Pattern 2: Storing Checkpoint State in the Output File

**What people do:** Try to deduce "what's already been fetched" by reading `costco-receipts.json` on startup and checking which barcodes are present.

**Why it's wrong:** The output file may be partially written, corrupted, or from a different run. It conflates "data I've collected" with "progress through the pipeline." Parsing a potentially large JSON file on every startup is wasteful.

**Do this instead:** Use a dedicated checkpoint file that's small, atomic, and purpose-built for tracking progress. Delete it when the fetch completes successfully.

### Anti-Pattern 3: Aggressive Concurrency Against Rate-Limited APIs

**What people do:** Use `Promise.all()` or p-queue with concurrency > 1 to fetch receipt details in parallel, assuming it will be faster.

**Why it's wrong:** Parallel requests against a rate-limited API hit the limit faster and trigger more 429 responses. The overhead of retry/backoff on multiple parallel streams often makes total completion time worse than sequential requests with proper spacing.

**Do this instead:** Sequential requests with proactive spacing (1-2 seconds between calls). This is predictable, debuggable, and minimizes rate limit encounters. The total time for 50 receipts at 1.5s spacing is 75 seconds -- fast enough for a CLI tool.

### Anti-Pattern 4: Infinite Retries Without Circuit Breaking

**What people do:** Retry forever on 429 responses, assuming the API will eventually respond.

**Why it's wrong:** If the bearer token has expired or the API is down for maintenance, infinite retries waste time and may get the IP blocked. The user sits waiting with no feedback.

**Do this instead:** Set a maximum retry count (5 retries per request) and a maximum total pipeline timeout. After exhausting retries on a single receipt, log the error and continue to the next receipt. Report skipped receipts at the end so the user can re-run later.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Costco GraphQL API | Resilient HTTP with retry + checkpoint | 429 responses observed in production; Retry-After header support unknown (implement defensively) |
| Actual Budget SDK | Direct SDK calls, no retry needed | Local/LAN service, failures are configuration errors not transient |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Pipeline <-> HTTP Layer | Function calls returning Promises | HTTP layer is generic, knows nothing about receipts |
| Pipeline <-> Checkpoint | Sync file I/O (read/write JSON) | Checkpoint format is an implementation detail of pipeline |
| CLI <-> Pipeline | Single async function call | Pipeline returns results; CLI writes final output file |
| Costco module <-> HTTP Layer | `resilientFetch()` replaces `fetch()` | Drop-in replacement; costco.ts query logic unchanged |

## Sources

- [AWS Architecture Blog: Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) -- Full jitter algorithm and performance comparison
- [AWS Builders' Library: Timeouts, retries and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) -- Production retry best practices
- [MDN: 429 Too Many Requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429) -- Retry-After header specification
- [p-queue on npm](https://www.npmjs.com/package/p-queue) -- Evaluated and deferred (unnecessary for sequential single-client use)
- [p-retry on npm](https://www.npmjs.com/package/p-retry) -- Evaluated; viable but custom implementation preferred for tighter control over 429 handling
- [Resilience mechanisms in API clients (2026)](https://medium.com/@pearl.rathour33/resilience-mechanisms-in-api-clients-retry-logic-circuit-breakers-and-fallbacks-09d8f58569d2) -- Circuit breaker pattern reference

---
*Architecture research for: Costco receipt scraping CLI with rate limit resilience*
*Researched: 2026-03-22*
