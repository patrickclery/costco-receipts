# Phase 1: HTTP Resilience - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace raw `fetch` calls in `src/costco.ts` with a retry-aware HTTP layer using `ky`. Classify errors as transient or permanent, implement exponential backoff with jitter on transient errors, respect Retry-After headers, and halt immediately on permanent errors (especially 401 expired token). Log retry attempts with wait durations.

</domain>

<decisions>
## Implementation Decisions

### HTTP Client
- **D-01:** Use `ky` as the HTTP client — drop-in fetch wrapper with built-in retry, backoff, and Retry-After parsing. Zero dependencies, ~3KB.
- **D-02:** Use `ky.create()` to create a shared instance with retry configuration. All HTTP calls (both list and detail queries) go through this instance.
- **D-03:** Replace `graphqlRequest()` internals with ky. Keep the same exported function signatures (`fetchReceiptList`, `fetchReceiptDetail`, `fetchAllReceipts`).

### Retry Behavior
- **D-04:** Base delay between requests: 3 seconds (up from 500ms). Conservative to avoid Akamai bot detection escalation.
- **D-05:** Exponential backoff with full jitter on retries. Base 2s, cap at 60s. Formula: `delay = random(0, baseDelay * 2^attempt)`.
- **D-06:** Max 5 retry attempts per request.
- **D-07:** On exhausting all retries: Claude decides based on error type — skip transient failures and continue to next receipt, halt on permanent failures.

### Error Classification
- **D-08:** Transient errors (retry): 429, 500, 502, 503, 504, network errors (ECONNRESET, ETIMEDOUT).
- **D-09:** Permanent errors (don't retry): 400, 401, 403, 404.
- **D-10:** On 401: halt the entire fetch immediately — token is expired, continuing is pointless.

### Error Messaging
- **D-11:** Informative retry output: show retry count, wait duration, and error type. Example: `Rate limited, retrying in 8.3s (attempt 2/5)`
- **D-12:** Actionable 401 message with instructions: tell user exactly how to get a new token from costco.ca DevTools (Network tab, copy `costco-x-authorization` header value).

### Claude's Discretion
- Exact ky configuration options (retry limit, methods, status codes, backoffLimit)
- Whether to add jitter to the base 3s inter-request delay (not just retry backoff)
- Whether `client-identifier` UUID should be per-session or per-request (current: per-request)
- Exact error message wording beyond the decisions above

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source Code
- `src/costco.ts` — Current fetch implementation with `graphqlRequest()`, `buildHeaders()`, `fetchAllReceipts()` loop
- `src/index.ts` — CLI orchestration, calls costco.ts functions
- `src/types.ts` — TypeScript interfaces for API responses

### Research
- `.planning/research/STACK.md` — Recommends ky@1.14.3 with specific configuration
- `.planning/research/PITFALLS.md` — Akamai bot detection risks, error classification guidance
- `.planning/research/ARCHITECTURE.md` — Build order and component boundaries

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `graphqlRequest<T>()` in `src/costco.ts` — Generic typed GraphQL wrapper, natural place to inject ky
- `buildHeaders()` in `src/costco.ts` — Header construction, can be passed to ky instance
- `sleep()` utility — Currently 500ms, will be replaced by ky's built-in backoff + 3s inter-request delay

### Established Patterns
- Generic typed API responses (`graphqlRequest<T>`)
- Environment variable injection at request time via `buildHeaders()`
- Console logging for progress at key pipeline stages

### Integration Points
- `graphqlRequest()` is the single point of contact with Costco API — all retry logic concentrates here
- `fetchAllReceipts()` loop has the inter-request `sleep(500)` that needs updating to 3s
- Error handling in the detail fetch loop (`try/catch` in `fetchAllReceipts()`) needs to use error classification

</code_context>

<specifics>
## Specific Ideas

- ky's POST retry requires explicit opt-in (`methods: ['post']`) — safe because GraphQL queries are read-only/idempotent
- Research suggests ky.create() instance pattern so all calls inherit the same resilience config
- The 401 error message should reference costco.ca DevTools specifically since that's how the user gets their token

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-http-resilience*
*Context gathered: 2026-03-22*
