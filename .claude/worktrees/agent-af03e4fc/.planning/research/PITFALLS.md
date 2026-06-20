# Pitfalls Research

**Domain:** Rate-limited private API scraping with retry/backoff (Costco GraphQL receipt fetcher)
**Researched:** 2026-03-22
**Confidence:** HIGH (patterns well-established; Costco-specific details are MEDIUM)

## Critical Pitfalls

### Pitfall 1: Retrying on every error type equally

**What goes wrong:**
The retry logic treats all HTTP errors the same -- 429 (rate limited), 401 (token expired), 403 (blocked/banned), 500 (server error), and 400 (bad request) all trigger the same exponential backoff. This wastes time retrying permanent failures and masks the real problem. A 400 from a malformed GraphQL query will never succeed no matter how many times you retry. A 401 means the bearer token expired and needs replacement, not a slower retry.

**Why it happens:**
Developers wrap the entire fetch in a generic `try/catch` or check `!res.ok` and funnel everything into the same retry path. It feels simpler than branching on status codes.

**How to avoid:**
Categorize errors into three buckets before deciding what to do:
- **Retryable** (429, 503, 502, network timeouts): Apply exponential backoff with jitter.
- **Auth failures** (401, 403): Stop retrying. Surface a clear message that the token has expired or the account is blocked. For 401 specifically, the user needs to obtain a fresh bearer token from their browser.
- **Client errors** (400, 404, 422): Never retry. Log the response body for debugging and skip the receipt.

In `graphqlRequest()`, branch on `res.status` before entering any retry loop. The current code already throws on `!res.ok` but does not distinguish status codes at all.

**Warning signs:**
- Retry logs showing the same error repeating 5+ times with increasing delays
- The tool hangs for minutes on what turns out to be an expired token
- Console output shows `Costco API 401` followed by retry attempts

**Phase to address:**
Phase 1 (Core retry mechanism) -- this is the foundational error classification that everything else depends on.

---

### Pitfall 2: No jitter in backoff causing synchronized retry storms

**What goes wrong:**
Pure exponential backoff (1s, 2s, 4s, 8s...) without jitter means that if a rate limit window resets at a specific time, all pending retries fire at the exact same moment. With Costco's API, this is relevant when the tool is fetching many receipt details in a loop -- if several requests hit 429 at roughly the same time, they all retry simultaneously, immediately triggering another 429 wave.

**Why it happens:**
The textbook exponential backoff formula `delay = baseDelay * 2^attempt` is deterministic. Developers implement it literally without adding randomness.

**How to avoid:**
Add full jitter: `delay = random(0, baseDelay * 2^attempt)`. Full jitter (not just "decorrelated jitter") is the recommended approach per AWS architecture guidance and is the simplest to implement. In practice:

```typescript
const delay = Math.random() * Math.min(maxDelay, baseDelay * Math.pow(2, attempt));
```

Cap the maximum delay at 30-60 seconds. For this project, a base delay of 1 second with a cap of 30 seconds is appropriate given the volume (typically under 300 receipts).

**Warning signs:**
- Multiple 429 errors appearing in clusters rather than individually
- Retry attempts all landing at the same timestamp in logs

**Phase to address:**
Phase 1 (Core retry mechanism) -- jitter must be built into the backoff formula from the start, not bolted on later.

---

### Pitfall 3: Bearer token expiration mid-fetch goes undetected

**What goes wrong:**
The Costco bearer token is manually obtained from a browser session and has a finite lifetime (likely 15-60 minutes based on typical OAuth patterns). The current `fetchAllReceipts()` function runs sequentially through potentially hundreds of receipts with 500ms delays between each. A fetch of 200 receipts takes ~100+ seconds, and with backoff delays could take much longer. The token can expire partway through, causing all subsequent requests to fail with 401. If the retry logic treats 401 as retryable, the tool burns through retry attempts on every remaining receipt before finally giving up.

**Why it happens:**
The token is set once at startup in `buildHeaders()` via `process.env.COSTCO_AUTH_TOKEN`. There is no mechanism to detect expiration, warn the user, or differentiate token expiry from other auth failures. The fetch loop in `costco.ts:240-250` catches errors but continues to the next receipt, so a token expiry mid-run silently fails every subsequent request.

**How to avoid:**
1. On first 401 response, immediately halt all fetching and report: "Bearer token expired. Re-obtain from browser and update COSTCO_AUTH_TOKEN."
2. Do NOT retry on 401 -- it will never succeed with the same token.
3. Before starting a long fetch run, make a lightweight probe request (e.g., fetch receipts for a 1-day window) to validate the token is still active.
4. Save progress so the user can resume after refreshing the token (see Pitfall 5).

**Warning signs:**
- Fetch starts successfully but begins failing partway through
- Console shows a wall of `ERROR fetching [barcode]: Error: Costco API 401` messages
- The saved JSON file has some receipt details but many are missing

**Phase to address:**
Phase 1 (Error classification) for detection; Phase 2 (Resume/checkpoint) for recovery.

---

### Pitfall 4: Costco blocks the account, not just the IP

**What goes wrong:**
Costco uses Akamai bot protection. Unlike typical rate limiting where you get 429s and can back off, Akamai may escalate to a hard block -- returning 403 Forbidden or serving a CAPTCHA challenge page. This block can be tied to the authenticated user's account (via the bearer token and client ID), not just the IP address. Backing off and retrying won't help. The tool might even jeopardize the user's Costco online account access.

**Why it happens:**
Developers assume rate limiting is purely request-frequency-based and that sufficient backoff always resolves it. Private APIs behind bot protection use behavioral analysis (request patterns, timing regularity, user-agent fingerprinting) and can permanently or semi-permanently block access.

**How to avoid:**
1. Set conservative rate limits proactively, not reactively. The current 500ms delay is aggressive for a private API. Use 2-3 second minimum delays between requests.
2. Add variable timing between requests (not just fixed delays) to avoid machine-like regularity: `await sleep(2000 + Math.random() * 2000)`.
3. If a 403 is received, stop immediately. Do not retry. Log a warning that the account may be flagged.
4. Limit the total number of requests per session. For example, cap at 50-100 receipt detail fetches per run and prompt the user to run again later for the remainder.
5. The `client-identifier` header currently sends a new UUID per request (`randomUUID()` in `buildHeaders()`). This is called on every `graphqlRequest()` invocation. Verify whether Costco expects a consistent client identifier per session versus per request -- inconsistency could trigger bot detection.

**Warning signs:**
- Receiving 403 instead of 429 on requests that previously worked
- The user can no longer log into costco.ca from their browser
- Responses contain HTML (CAPTCHA page) instead of JSON

**Phase to address:**
Phase 1 (Conservative defaults and hard-stop on 403) -- this must be in place before any large-scale fetching is attempted.

---

### Pitfall 5: No checkpoint/resume causes full re-fetch after interruption

**What goes wrong:**
The current `fetchAllReceipts()` accumulates all receipt details in memory and only writes to `costco-receipts.json` after the entire fetch completes (in `index.ts:59`). If the process is interrupted -- by a rate limit, token expiry, network failure, or Ctrl+C -- all progress is lost. The user must restart from scratch, re-fetching receipts they already successfully retrieved, which doubles the API load and doubles the chance of hitting rate limits again.

**Why it happens:**
The initial implementation prioritized simplicity: fetch everything, then write. Adding checkpointing feels like premature optimization. But for a rate-limited API where interruptions are the expected case (not the exception), this is a critical gap.

**How to avoid:**
1. Write each receipt detail to the JSON file incrementally as it is fetched, not all at once at the end.
2. On startup, check the existing JSON file for already-fetched barcodes and skip them.
3. Use the barcode as the deduplication key (already available in `ReceiptSummary.transactionBarcode`).
4. Pattern: maintain a `Set<string>` of fetched barcodes loaded from the existing file. Before fetching a receipt detail, check if its barcode is already in the set.

Implementation approach:
```typescript
// Load existing progress
const existing = existsSync(DATA_FILE) ? JSON.parse(readFileSync(DATA_FILE, 'utf-8')) : { details: [] };
const fetchedBarcodes = new Set(existing.details.map(d => d.transactionBarcode));

// In fetch loop
if (fetchedBarcodes.has(receipt.transactionBarcode)) {
  console.log(`  Skipping (already fetched): ${receipt.transactionBarcode}`);
  continue;
}
```

**Warning signs:**
- User reports "it fetched 150 receipts last time but crashed, now it's starting over"
- API request count is higher than expected on second run
- Rate limit hit more frequently on retry runs

**Phase to address:**
Phase 2 (Resume/checkpoint) -- but the data structure design should be decided in Phase 1 to avoid migration headaches.

---

### Pitfall 6: Unbounded retry count leads to infinite loops or excessive delays

**What goes wrong:**
Without a maximum retry count and maximum total backoff time, the retry loop can run indefinitely. With exponential backoff, retry 10 would wait ~17 minutes (2^10 seconds). The tool appears to hang with no feedback. Worse, if the delay cap is too high and the API is genuinely down, the user stares at a terminal doing nothing for 30+ minutes.

**Why it happens:**
Developers set up the exponential formula but forget to set bounds. Or they set a max retry count (e.g., 10) but don't realize that 10 retries with exponential backoff and a 60-second cap means up to 10 minutes of waiting for a single request.

**How to avoid:**
Set three bounds:
1. **Max retries per request:** 3-4 attempts (not 10). For a private API with no SLA, if it doesn't work after 3 tries, it's not a transient issue.
2. **Max delay cap:** 30 seconds. No single wait should exceed this.
3. **Max total session time:** If the total fetch has been running for over N minutes with repeated failures, abort gracefully and save progress.

Provide clear console output during waits: `"Rate limited. Retrying in 12s (attempt 2/4)..."` so the user knows the tool hasn't frozen.

**Warning signs:**
- The CLI appears frozen with no output for more than 30 seconds
- Log shows retry attempt counts reaching double digits
- Total execution time is many multiples of the expected time

**Phase to address:**
Phase 1 (Core retry mechanism) -- bounds must be set when the retry logic is first implemented.

---

### Pitfall 7: Ignoring the Retry-After header

**What goes wrong:**
When Costco returns a 429, it may include a `Retry-After` header specifying exactly how long to wait (in seconds or as an HTTP date). Ignoring this and using a fixed exponential backoff means either waiting too long (wasting time) or not waiting long enough (immediately hitting another 429). Some APIs treat ignoring `Retry-After` as a signal of bot behavior and escalate to a block.

**Why it happens:**
The `Retry-After` header is easy to overlook because the exponential backoff "feels like enough." Developers implement their own delay calculation without checking what the server told them.

**How to avoid:**
Parse the `Retry-After` header when present and use it as the minimum delay:

```typescript
if (res.status === 429) {
  const retryAfter = res.headers.get('retry-after');
  let delay: number;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    delay = isNaN(seconds)
      ? new Date(retryAfter).getTime() - Date.now()  // HTTP date format
      : seconds * 1000;  // Seconds format
  } else {
    delay = calculateExponentialBackoff(attempt);
  }
  await sleep(Math.max(delay, 1000)); // Floor at 1 second
}
```

Use `Retry-After` as the delay when present; fall back to calculated exponential backoff only when the header is absent.

**Warning signs:**
- Repeated 429s in rapid succession despite backoff
- The tool recovers from rate limits much slower than expected (over-waiting)

**Phase to address:**
Phase 1 (Core retry mechanism) -- must be part of the initial 429 handling.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Fixed `sleep(500)` between requests | Simple, no retry infrastructure needed | Fails as soon as rate limits are enforced, no recovery | Never, for a rate-limited API |
| Catch-and-continue in detail fetch loop | One bad receipt doesn't stop the batch | Silent data loss; user doesn't know 40% of receipts failed | Only if failures are logged AND a summary reports the count |
| Accumulate all in memory, write once at end | Simple code, atomic file write | All progress lost on interruption; high memory for large histories | Only for very small datasets (<20 receipts) |
| New `randomUUID()` per request as `client-identifier` | Simple header construction | May trigger bot detection if Costco expects session-consistent identifiers | Unknown -- needs testing. Track as a variable to investigate |
| Hardcoded User-Agent string | Works initially | Costco can fingerprint and block this specific UA; becomes stale as Firefox versions advance | Never for production scraping |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Costco GraphQL API | Treating it like a public API with defined rate limits and documentation | It is an undocumented private API. Assume limits are strict, undocumented, and can change without notice. Build conservatively. |
| Costco GraphQL API | Retrying POST requests assuming idempotency | GraphQL queries over POST are read-only and safe to retry, but verify the endpoint doesn't have side effects (e.g., logging, analytics). In this codebase all operations are `query`, not `mutation`, so retrying is safe. |
| Costco GraphQL API | Assuming the `receipts` array is always present and non-empty | The current code does `data.data.receiptsWithCounts.receipts[0]` in `fetchReceiptDetail` (line 209) with no null check. A 200 response with an empty receipts array will crash. |
| Costco Auth | Using the same bearer token across multiple runs over hours/days | Bearer tokens expire. Each run should validate the token before starting the batch. |
| Actual Budget API | Not considering Actual's own rate limits during import | The import uses `importTransactions()` which batches transactions. If the batch is very large (500+ transactions with subtransactions), it may overwhelm Actual's SQLite backend. Consider chunking imports into batches of 50. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sequential fetching with fixed delays | 200 receipts * 2s delay = 7+ minutes minimum | Cannot parallelize against a rate-limited private API. Accept sequential but make delays adaptive -- shorter when no rate limits hit, longer after 429s. | Always slow, but acceptable for <500 receipts |
| Re-fetching entire history every run | Each run takes the same time regardless of how many new receipts exist | Checkpoint fetched barcodes. On subsequent runs, skip already-fetched receipts. Only fetch receipt details for new summaries. | Immediately -- first repeat run doubles API load unnecessarily |
| Exponential backoff with no cap | A single receipt's retry cycle takes 30+ minutes | Cap max delay at 30s, max retries at 4. After max retries, skip the receipt and continue. | After 6-7 retry attempts |
| Memory accumulation for large histories | Process crashes with OOM on very large datasets | Stream receipts to file as fetched. In practice, unlikely for a personal Costco account (<1000 receipts lifetime). | ~5000+ receipts (theoretical) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging full API responses during debugging | Receipt data contains membership numbers, purchase history, payment card last-4-digits | Redact `membershipNumber`, `displayAccountNumber`, and `tenderAcctTxnNumber` from any log output. Use a structured logger that can filter sensitive fields. |
| Storing bearer token in `.env` without expiry awareness | Stale tokens remain in `.env` indefinitely; if the file is leaked, old tokens may still be valid | Document that tokens should be obtained fresh each session. Consider clearing the token from `.env` after a successful run. |
| Hardcoded User-Agent matching a specific Firefox version | Creates a unique fingerprint that Costco can track and block; also becomes outdated | Rotate or update the UA string. At minimum, update the version number. Better: use the system's actual browser UA string if available. |
| No TLS certificate validation override | Not a current issue, but a common mistake in scraping projects | Never disable TLS verification, even for debugging. The current code uses native `fetch` which validates by default. Do not add `NODE_TLS_REJECT_UNAUTHORIZED=0`. |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent progress during long backoff waits | User thinks tool is frozen, kills the process, loses progress | Print countdown: `"Rate limited. Waiting 15s before retry (attempt 2/4)..."`. Update in-place if terminal supports it. |
| No summary of failed receipts at end of run | User doesn't know 30 receipts failed; assumes all data is imported | Print a failure summary: `"Completed: 170/200 receipts fetched. 30 failed (see errors above). Re-run to retry failed receipts."` |
| Error messages showing raw HTTP status codes | User sees `Costco API 429: [blob of HTML]` and doesn't know what to do | Translate status codes to actionable messages: `"Rate limited by Costco. The tool will automatically retry."` or `"Authentication expired. Please obtain a new bearer token from your browser."` |
| No distinction between "nothing new to fetch" and "fetch failed" | User can't tell if a short run means they're up to date or something broke | Separate messaging: `"All receipts already fetched (up to date)"` vs `"Fetch interrupted after 50/200 receipts. Re-run to continue."` |
| Ctrl+C during fetch loses all progress | User wants to stop but loses 10 minutes of fetched data | Handle SIGINT gracefully: save current progress to file, then exit. |

## "Looks Done But Isn't" Checklist

- [ ] **Retry logic:** Often missing jitter -- verify delays have randomness, not just `baseDelay * 2^n`
- [ ] **Retry logic:** Often missing max retry cap -- verify there is both a per-request limit AND a max delay cap
- [ ] **Retry logic:** Often retries wrong errors -- verify 400/401/403 are NOT retried, only 429/5xx/network errors
- [ ] **Retry-After:** Often ignored even when implemented -- verify the `Retry-After` header is parsed from 429 responses and used as the delay floor
- [ ] **Resume:** Often checks file existence but not content -- verify that loading the checkpoint file handles corrupt/partial JSON gracefully
- [ ] **Resume:** Often skips summaries but re-fetches details -- verify that both the summary fetch AND the detail fetch are resumable
- [ ] **Progress reporting:** Often logs per-receipt but no summary -- verify a final summary reports successes, failures, and skipped counts
- [ ] **Token validation:** Often only checked at startup -- verify that a 401 mid-run halts fetching immediately (not just logs and continues)
- [ ] **Graceful shutdown:** Often missing -- verify that SIGINT/SIGTERM saves progress to disk before exit
- [ ] **Rate limit defaults:** Often too aggressive -- verify the base delay between requests is at least 2 seconds, not 500ms

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Token expired mid-fetch | LOW | Save progress to file. User obtains new token. Re-run; tool resumes from checkpoint. |
| Account blocked by Akamai (403) | HIGH | Stop using the tool for 24-48 hours. Verify account access via browser. Reduce request frequency in config. If persistent, may need to rotate approach entirely. |
| Partial data written (corrupt JSON) | MEDIUM | Validate JSON on load. If parse fails, attempt to recover valid entries. Keep a `.bak` copy of the previous successful file before overwriting. |
| Retry storm after rate limit | LOW | Already resolved by adding jitter. If currently happening: kill the process, wait 5 minutes, restart with more conservative settings. |
| All receipts failed silently | MEDIUM | Review logs for error pattern. If all errors are 401: token issue. If all 429: increase base delay. If mixed: check API availability. Re-run after fixing root cause. |
| Progress lost after Ctrl+C | LOW (with checkpoint) | If checkpoint is implemented: re-run and it resumes. If not implemented yet: re-run from scratch (which is the whole point of implementing checkpointing). |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Retrying on every error type equally | Phase 1: Core retry | Unit test that 400 is not retried, 401 halts, 429 triggers backoff |
| No jitter in backoff | Phase 1: Core retry | Verify delay values have variance across multiple invocations |
| Bearer token expiry mid-fetch | Phase 1: Error classification | Integration test: mock 401 mid-batch, verify immediate halt with message |
| Account blocked by Akamai | Phase 1: Conservative defaults | Code review: base delay >= 2s, variable timing, 403 causes immediate stop |
| No checkpoint/resume | Phase 2: Resume capability | Test: interrupt after 5 receipts, re-run, verify only remaining receipts are fetched |
| Unbounded retry count | Phase 1: Core retry | Code review: max retries <= 4, max delay <= 30s, verify bounds in tests |
| Ignoring Retry-After header | Phase 1: Core retry | Unit test: mock 429 with Retry-After header, verify parsed delay is used |
| Silent data loss in fetch loop | Phase 1: Error reporting | Run with deliberate failures, verify summary reports failure count |
| Graceful shutdown on SIGINT | Phase 2: Resume capability | Manual test: Ctrl+C during fetch, verify JSON file contains partial results |
| Aggressive default timing (500ms) | Phase 1: Conservative defaults | Code review: verify minimum delay is 2000ms + random jitter |

## Sources

- [API Rate Limit Exceeded - Causes, Fixes & Prevention (2026)](https://www.digitalapi.ai/blogs/api-rate-limit-exceeded)
- [Dealing with Rate Limiting Using Exponential Backoff](https://substack.thewebscraping.club/p/rate-limit-scraping-exponential-backoff)
- [Respect API Rate Limits With a Backoff - Vonage](https://developer.vonage.com/en/blog/respect-api-rate-limits-with-a-backoff-dr)
- [Stop Getting Blocked: 10 Common Web-Scraping Mistakes - Firecrawl](https://www.firecrawl.dev/blog/web-scraping-mistakes-and-fixes)
- [How to Implement Retry Logic with Exponential Backoff in Node.js](https://oneuptime.com/blog/post/2026-01-06-nodejs-retry-exponential-backoff/view)
- [API Rate Limiting at Scale: Patterns, Failures, and Control Strategies - Gravitee](https://www.gravitee.io/blog/rate-limiting-apis-scale-patterns-strategies)
- [Retry-After Header - How HTTP Works](https://howhttpworks.com/headers/retry-after)
- [Building Resilient GraphQL APIs Using Idempotency - Shopify Engineering](https://shopify.engineering/building-resilient-graphql-apis-using-idempotency)
- [How to Handle Rate Limits - OpenAI Cookbook](https://developers.openai.com/cookbook/examples/how_to_handle_rate_limits)
- Codebase analysis: `src/costco.ts`, `src/index.ts`, `src/actual.ts`, `.planning/codebase/CONCERNS.md`

---
*Pitfalls research for: Rate-limited private API scraping with retry/backoff (Costco receipt fetcher)*
*Researched: 2026-03-22*
