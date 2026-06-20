# Feature Research

**Domain:** Rate-limited API consumer CLI / receipt data pipeline
**Researched:** 2026-03-22
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any reliable rate-limited API consumer must have. Without these, the tool will fail partway through fetches and require manual restarts -- which is exactly the problem the milestone is solving.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Exponential backoff on HTTP 429/5xx | Without it, retries hammer the server at the same rate and get blocked harder. Industry standard pattern (AWS, Google, every major API provider recommends it). | LOW | Formula: `delay = initialDelay * (2 ^ retryNumber)`. Start at 1s, cap at 60s. Use full jitter: `actualDelay = random(0, exponentialDelay)` to prevent synchronized retries. |
| Retry-After header respect | Costco's API may return `Retry-After` with 429 responses. Ignoring it risks IP blocks or extended bans. The header is the server telling you exactly how long to wait. | LOW | Parse both delta-seconds and HTTP-date formats. If present, use it instead of calculated backoff. Fall back to exponential backoff when header is absent. |
| Max retry limit | Without a cap, the tool retries forever on persistent failures (auth expired, API changed). Must distinguish transient errors (429, 503, network timeout) from permanent errors (401, 404). | LOW | 5 retries is standard. Bail immediately on 401 (expired token) and 400 (bad request) -- these will never succeed on retry. |
| Resume interrupted fetches | The core problem: a fetch of 50+ receipts dies at receipt #30 due to rate limiting, and the user has to start over. Already-fetched data must persist so the next run skips them. | MEDIUM | Write each receipt detail to the JSON file incrementally (or maintain a progress file). On startup, read existing data, compute the set of already-fetched barcodes, and skip them. |
| Graceful shutdown on SIGINT | User presses Ctrl+C during a long fetch. Without signal handling, partially fetched data is lost. With it, current progress is saved before exit. | LOW | Listen for `SIGINT` and `SIGTERM`. Set a flag to stop the fetch loop after the current receipt completes, then write progress to disk before exiting. |
| Error classification (transient vs permanent) | Not all errors deserve retries. Retrying a 401 (expired token) wastes time and delays the user from getting a useful error message. | LOW | Transient: 429, 500, 502, 503, 504, network errors (ECONNRESET, ETIMEDOUT). Permanent: 400, 401, 403, 404. Bail on permanent errors with clear message. |
| Progress reporting | When fetching 50+ receipts with backoff delays, silence is unacceptable. User needs to know: how many done, how many remaining, current wait time. | LOW | Log each receipt fetch with counter (e.g., `[12/47] Fetching detail: 2025-06-15 Costco Ottawa ($234.56)...`). Log retry attempts and wait durations. |

### Differentiators (Nice to Have)

Features that improve the experience but are not required for the tool to complete its job reliably.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Incremental JSON writes | Instead of accumulating all receipts in memory and writing once at the end, append each receipt to the output file as it is fetched. Provides crash resilience -- data is never lost. | MEDIUM | Requires changing from `writeFileSync` of the full object to incremental updates. Could read/parse/re-write the JSON file after each receipt, or use a simpler line-delimited format for the progress file. |
| Dry-run mode (`--dry-run`) | Show what would be fetched without making API calls. Useful for verifying token works (single lightweight API call) and seeing receipt count before committing to a long fetch. | LOW | Fetch the receipt list (summary) only, display count and date range, then exit. No detail fetches. Could be combined with `--fetch-only`. |
| Configurable concurrency/throttle | Allow user to tune request rate via CLI flag (e.g., `--delay=2000`). Different Costco accounts or times of day may have different rate limit tolerances. | LOW | Default to current 500ms, but accept `--delay <ms>` to override. Simple and useful escape hatch. |
| Structured logging with verbosity levels | `--verbose` for debug-level output (request/response details, timing), `--quiet` for minimal output (errors only). Default shows progress. | LOW | Three levels: quiet (errors), normal (progress), verbose (request details, response codes, retry timing). Useful for debugging rate limit issues. |
| Token expiry detection and early warning | Detect 401 responses and immediately surface a clear message: "Your Costco auth token has expired. Get a new one from browser DevTools." Instead of retrying or cryptic errors. | LOW | Already partially exists (error logging). Enhance with specific messaging for 401 that tells the user exactly what to do. |
| Date range filtering (`--since`, `--until`) | Fetch only receipts within a specific date range instead of all history. Useful for incremental updates after initial full fetch. | MEDIUM | Add `--since=YYYY-MM-DD` and `--until=YYYY-MM-DD` flags. Modify the date-range loop in `fetchAllReceipts()` to respect bounds. Reduces API calls on subsequent runs. |

### Anti-Features (Deliberately NOT Building)

Features that seem useful but create problems for this specific use case.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Parallel/concurrent receipt fetching | "Fetch 5 receipts at once for speed" | Costco's API is already rate-limiting sequential requests. Concurrent requests will trigger rate limits faster and harder. This is an undocumented internal API -- being aggressive risks IP blocks or account flags. | Sequential fetching with smart delays is the correct approach for an undocumented API. Speed is not the bottleneck; reliability is. |
| Automatic token refresh / OAuth flow | "Automate the auth so I never have to manually get a token" | Costco has no public API or OAuth flow. The token comes from browser DevTools. Automating this requires headless browser login, which is fragile, breaks on Costco site changes, and may violate ToS. Massive complexity for marginal gain. | Keep manual token extraction. Tokens last long enough for batch operations. Add clear error message when token expires. |
| Database storage (SQLite, Postgres) | "Store receipts in a database instead of JSON" | Over-engineering for a single-user CLI tool that fetches data infrequently. JSON files are inspectable, portable, and sufficient. A database adds a dependency, migration complexity, and setup friction for zero benefit. | Keep JSON file storage. It works, it is debuggable, it serves as both data format and backup. |
| Scheduled/cron execution | "Run this automatically every week" | The token expires and must be manually refreshed. Automated runs will silently fail until the user notices. Creates false sense of reliability. | Manual invocation when the user has a fresh token. The tool runs in under a minute once rate limiting is handled. |
| Web UI / dashboard | "Show receipts in a browser" | Actual Budget already provides the UI. This tool's job is to get data into Actual Budget, not to replicate its visualization. Scope creep that doubles the project size. | Use Actual Budget's built-in reporting and categorization features. |
| Proxy rotation / IP spoofing | "Rotate IPs to avoid rate limits" | This is a personal tool for your own purchase data, not a scraping operation. Proxy rotation signals adversarial behavior and could get the Costco account flagged. Ethically questionable for accessing your own data. | Respect rate limits with backoff. The data is yours; there is no reason to hide your identity from Costco. |
| Real-time / webhook notifications | "Notify me when new receipts appear" | Costco has no webhook or push API. Polling creates unnecessary load and fails without a valid token. Receipts appear after in-store purchases which the user already knows about. | Run the tool manually after a Costco trip. Batch processing matches the actual usage pattern. |

## Feature Dependencies

```
[Retry with exponential backoff]
    |
    +--requires--> [Error classification (transient vs permanent)]
    |
    +--enhances--> [Retry-After header respect]
    |
    +--requires--> [Max retry limit]

[Resume interrupted fetches]
    |
    +--requires--> [Graceful shutdown on SIGINT]
    |                   (must save progress before exit)
    |
    +--enhances--> [Incremental JSON writes]
                       (crash-safe without needing graceful shutdown)

[Progress reporting]
    |
    +--enhances--> [Retry with exponential backoff]
    |                   (shows retry count and wait time)
    |
    +--enhances--> [Resume interrupted fetches]
                       (shows "Skipping 12 already-fetched receipts")

[Date range filtering]
    |
    +--independent-- (no hard dependencies, enhances resume workflow)

[Dry-run mode]
    |
    +--independent-- (subset of existing fetch flow)
```

### Dependency Notes

- **Retry requires error classification:** Must distinguish retryable errors (429, 5xx, network) from permanent errors (401, 404) to avoid wasting retries on failures that will never succeed.
- **Resume requires graceful shutdown:** If the process is interrupted without saving state, there is nothing to resume from. These two features work together.
- **Incremental writes enhance resume:** If receipts are written as they are fetched, even an ungraceful crash (kill -9, power loss) preserves progress. This makes resume more robust but is not strictly required if graceful shutdown works.
- **Progress reporting enhances everything:** Not a dependency, but backoff delays and resume skips are confusing without progress output explaining what is happening and why.

## MVP Definition

### Launch With (This Milestone)

Minimum set to make fetching complete reliably, which is the stated goal.

- [x] Exponential backoff with jitter on 429/5xx responses -- core fix for the rate limiting problem
- [x] Retry-After header respect -- let the server tell us when to retry
- [x] Max retry limit with error classification -- bail on permanent errors, retry transient ones
- [x] Resume interrupted fetches -- skip already-fetched receipts on re-run
- [x] Graceful shutdown on SIGINT -- save progress when user presses Ctrl+C
- [x] Progress reporting with counters -- user knows what is happening during long fetches

### Add After Validation (Next Milestone)

Features to add once the core resilience is working and tested.

- [ ] Date range filtering (`--since`, `--until`) -- add when users want incremental updates
- [ ] Configurable delay (`--delay <ms>`) -- add if default timing needs per-user tuning
- [ ] Verbose/quiet logging levels -- add when debugging rate limit issues becomes a pattern
- [ ] Dry-run mode -- add when users want to preview before committing to a long fetch
- [ ] Incremental JSON writes -- add if ungraceful crashes (not Ctrl+C) lose data in practice

### Future Consideration (v2+)

Features to defer indefinitely unless clear need emerges.

- [ ] Token expiry early warning -- defer until manual token management becomes painful enough
- [ ] Date-based incremental sync -- defer until the full history is imported and only new receipts matter

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Exponential backoff with jitter | HIGH | LOW | P1 |
| Error classification | HIGH | LOW | P1 |
| Max retry limit | HIGH | LOW | P1 |
| Retry-After header respect | HIGH | LOW | P1 |
| Resume interrupted fetches | HIGH | MEDIUM | P1 |
| Graceful shutdown (SIGINT) | HIGH | LOW | P1 |
| Progress reporting (counters) | MEDIUM | LOW | P1 |
| Date range filtering | MEDIUM | MEDIUM | P2 |
| Configurable delay | LOW | LOW | P2 |
| Verbose/quiet logging | LOW | LOW | P2 |
| Dry-run mode | LOW | LOW | P2 |
| Incremental JSON writes | MEDIUM | MEDIUM | P3 |
| Token expiry detection | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for this milestone (reliability)
- P2: Should have, add when possible (ergonomics)
- P3: Nice to have, future consideration (robustness)

## Competitor/Reference Feature Analysis

This is a niche personal tool, but the patterns come from well-established domains.

| Feature | Web Scraping Tools (Scrapy, Crawlee) | API Client Libraries (axios-retry, p-retry) | ETL Pipelines (Airbyte, Fivetran) | Our Approach |
|---------|--------------------------------------|----------------------------------------------|-----------------------------------|--------------|
| Retry with backoff | Built-in, configurable | Core feature, decorrelated jitter | Built-in with monitoring | Custom implementation in `graphqlRequest()` wrapper. Use full jitter. |
| Resume/checkpoint | Crawl state persistence, auto-resume | Not applicable (single request scope) | Cursor-based incremental sync | Track fetched barcodes in the JSON output file. Skip on re-run. |
| Rate limit respect | DOWNLOAD_DELAY, AutoThrottle middleware | Retry-After parsing, 429 detection | Provider-specific rate limit handling | Parse 429 + Retry-After. Fall back to exponential backoff. |
| Progress | Scrapy stats, progress bars | Not applicable | Dashboard, logs | Console counter: `[N/Total] Fetching...` with retry/wait info |
| Graceful shutdown | SIGINT saves crawl state | Not applicable | Checkpoint on shutdown | SIGINT handler writes progress JSON before exit |

## Sources

- [AWS Builders Library: Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) -- authoritative reference for retry/backoff patterns
- [Better Stack: Mastering Exponential Backoff](https://betterstack.com/community/guides/monitoring/exponential-backoff/) -- jitter strategy comparison (full, equal, decorrelated)
- [The Web Scraping Club: Dealing with Rate Limiting Using Exponential Backoff](https://substack.thewebscraping.club/p/rate-limit-scraping-exponential-backoff) -- scraping-specific rate limit patterns
- [OpenAI Cookbook: How to handle rate limits](https://cookbook.openai.com/examples/how_to_handle_rate_limits) -- practical rate limit handling examples
- [sindresorhus/p-retry on GitHub](https://github.com/sindresorhus/p-retry) -- reference implementation of retry with exponential backoff for Node.js
- [p-throttle on npm](https://www.npmjs.com/package/p-throttle) -- windowed rate limiting for promise-returning functions
- [OneUptime: How to Build a Graceful Shutdown Handler in Node.js](https://oneuptime.com/blog/post/2026-01-06-nodejs-graceful-shutdown-handler/view) -- SIGINT/SIGTERM handling patterns
- [Medium: Building Idempotent Data Pipelines](https://medium.com/towards-data-engineering/building-idempotent-data-pipelines-a-practical-guide-to-reliability-at-scale-2afc1dcb7251) -- checkpoint and idempotency patterns for data pipelines

---
*Feature research for: rate-limited API consumer CLI / receipt data pipeline*
*Researched: 2026-03-22*
