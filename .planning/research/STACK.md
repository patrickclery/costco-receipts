# Stack Research

**Domain:** Rate limiting, retry logic, and resilient HTTP fetching for a Node.js/TypeScript CLI tool
**Researched:** 2026-03-22
**Confidence:** HIGH

## Current State

The project currently uses Node.js native `fetch` with no retry logic, no rate limit handling, and a naive `sleep(500)` between sequential requests. When Costco's API returns a rate-limit response, the fetch fails and the receipt is skipped with a logged error. The tool makes sequential GraphQL POST requests to `ecom-api.costco.com`.

**Key constraints that shape the recommendation:**
- All API calls are GraphQL POST requests (most retry libraries exclude POST by default)
- Requests are sequential (one receipt detail at a time) -- no need for complex concurrency control
- The project runs via `tsx` (handles ESM-only packages natively)
- Node.js 22.22.1 is installed (exceeds all library requirements)
- The tool is a batch CLI, not a server -- simplicity trumps sophistication

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| ky | 1.14.3 | HTTP client wrapping native fetch | Built-in retry with exponential backoff, Retry-After header parsing, 429/503 handling, zero dependencies, TypeScript-native. Replaces raw `fetch` with a single library that solves retry, backoff, and rate limit detection all at once. |

**Confidence: HIGH** -- verified version 1.14.3 via `npm view`, zero dependencies confirmed, ESM-only with TypeScript types included, requires Node >= 18 (we have 22).

### Why ky and Not p-retry + raw fetch

The project only needs HTTP retry logic (not general-purpose async retry). `ky` provides everything needed in one package:

1. **Retry with exponential backoff** -- default delay formula: `0.3 * (2 ** (attemptCount - 1)) * 1000` with configurable jitter
2. **Automatic Retry-After header parsing** -- for 429 and 503 responses, ky reads `Retry-After` (and non-standard `RateLimit-Reset`) and waits the correct duration
3. **Configurable retry methods** -- POST is excluded by default but trivially added: `methods: ['post']`
4. **maxRetryAfter cap** -- prevents the tool from waiting absurdly long if the server returns a huge Retry-After value
5. **beforeRetry hook** -- perfect for logging retry attempts to the console in a CLI context
6. **Zero dependencies** -- ky wraps native fetch with no dependency tree
7. **TypeScript-first** -- types are bundled, not @types

With `p-retry` + raw `fetch`, you would need to manually check `res.status === 429`, parse `Retry-After`, calculate delays, and handle all edge cases. `ky` does all of this out of the box.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| p-retry | 7.1.1 | General-purpose async retry with exponential backoff | Only if you need retry logic for non-HTTP operations (e.g., retrying Actual Budget API connection). Not needed for HTTP calls since ky handles that. |

**Confidence: HIGH** -- verified version 7.1.1 via `npm view`, ESM-only, requires Node >= 20, depends on `is-network-error`.

p-retry is the right choice if you later need to retry non-HTTP operations (like reconnecting to Actual Budget's server). But for the HTTP retry milestone, ky alone is sufficient.

### Development Tools

No new development tools are required for this milestone. The existing `tsx` + `typescript` setup handles ESM-only packages correctly.

## Installation

```bash
# Core -- the only new dependency needed
npm install ky
```

If non-HTTP retry is needed later:
```bash
npm install p-retry
```

## Recommended Configuration for This Project

```typescript
import ky from 'ky';

const costcoApi = ky.create({
  prefixUrl: 'https://ecom-api.costco.com/ebusiness/order/v1/orders',
  retry: {
    limit: 5,                    // Up from ky's default of 2
    methods: ['post'],           // GraphQL uses POST -- must opt in
    statusCodes: [408, 429, 500, 502, 503, 504],
    backoffLimit: 30_000,        // Cap at 30s between retries
    maxRetryAfter: 120_000,      // Don't wait more than 2 min on Retry-After
  },
  timeout: 30_000,               // 30s per request
  hooks: {
    beforeRetry: [
      ({ retryCount }) => {
        console.log(`  Retry attempt ${retryCount}...`);
      },
    ],
  },
  headers: {
    // ... existing headers from buildHeaders()
  },
});
```

**Why these specific values:**
- `limit: 5` -- Costco's rate limiting can be aggressive; 2 retries (default) is too few for batch fetching dozens of receipts
- `methods: ['post']` -- all Costco API calls are GraphQL POST; ky excludes POST by default because POST is typically non-idempotent, but GraphQL queries are read-only and safe to retry
- `backoffLimit: 30_000` -- prevents exponential backoff from spiraling (5th retry would otherwise be ~5s, but if Costco sends Retry-After headers, this caps the inter-request delay)
- `maxRetryAfter: 120_000` -- if Costco says "retry after 10 minutes," we cap at 2 minutes and try anyway; a CLI user does not want to wait 10 minutes silently
- `timeout: 30_000` -- Costco's API can be slow; 30s is generous but prevents hanging indefinitely

## Inter-Request Throttling (Separate from Retry)

The current `sleep(500)` between requests is a separate concern from retry logic. This proactive throttle prevents triggering rate limits in the first place. Recommendation:

**Use a simple async delay utility** -- no library needed. The current `sleep()` helper is fine, but increase the delay:

```typescript
const THROTTLE_MS = 1_500; // 1.5s between requests to avoid triggering 429s
await sleep(THROTTLE_MS);
```

**Why 1.5s instead of 500ms:** The current 500ms triggers rate limits. 1.5s is conservative enough to avoid 429s for most Costco API behavior while still completing a batch of 50 receipts in ~75 seconds. If 429s still occur, ky's retry handles them automatically.

**Do NOT use p-queue or p-throttle** for this project -- the requests are already sequential and single-threaded. A concurrency-limiting queue adds complexity with zero benefit when concurrency is already 1.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| ky | p-retry + native fetch | If you want zero HTTP client abstraction and need retry for non-HTTP operations too. More manual work for the same result. |
| ky | got | If you need streams, pagination, or advanced HTTP features. Overkill for simple JSON API calls. |
| ky | axios + axios-retry | If the project already used axios. Do not introduce axios into a project using native fetch. |
| Simple sleep() | p-throttle / p-queue | If you need concurrent requests with rate limiting. This project is sequential -- unnecessary complexity. |
| Simple sleep() | bottleneck | If you need distributed rate limiting across multiple processes. Not applicable to a single-user CLI. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| axios | Pulls in follow-redirects and other legacy deps. The project already uses native fetch. Axios was designed for a pre-fetch era. | ky (wraps native fetch) |
| axios-retry | Only useful if you are already on axios. Adds another dependency on top of an unnecessary one. | ky (retry is built in) |
| got | 750KB installed, designed for server-to-server with features like streams, pagination, caching. Massive overkill for simple GraphQL POST requests. | ky (12KB, does exactly what is needed) |
| node-fetch | Polyfill for native fetch. Node 18+ has native fetch built in. Node 22 is fully stable. Adding node-fetch is actively wrong. | Native fetch (via ky) |
| bottleneck | Distributed rate limiter with Redis support, cluster mode. Designed for multi-process servers, not single-user CLI tools. | Simple sleep() between requests |
| p-queue | Concurrency limiter. Requests are already sequential. Adding a queue around sequential calls is complexity theater. | Sequential loop with sleep() |
| fetch-retry | Wraps fetch to add retry, but less feature-rich than ky (no Retry-After parsing, no hooks, no typed errors). If you are going to wrap fetch, use ky. | ky |
| Custom retry wrapper | Hand-rolling exponential backoff, Retry-After parsing, jitter, and error classification is ~80 lines of code that ky already handles with battle-tested edge cases. | ky |

## Stack Patterns

**For this project (sequential CLI batch fetcher):**
- Use `ky` for all HTTP calls with retry config
- Use `sleep()` between requests as proactive throttle
- No concurrency control needed (requests are serial)

**If this were a server processing webhooks:**
- Use `p-queue` for concurrency control
- Use `ky` for outbound HTTP with retry
- Use `p-throttle` for rate-limiting outbound calls

**If this were retrying non-HTTP operations:**
- Use `p-retry` to wrap any async function
- Use `ky` separately for HTTP calls

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| ky@1.14.3 | Node >= 18 | Zero dependencies. ESM only. TypeScript types bundled. |
| p-retry@7.1.1 | Node >= 20 | ESM only. Depends on is-network-error@^1.1.0. TypeScript types bundled. |
| tsx@4.21.0 | Node >= 18 | Already in project. Handles ESM-only imports correctly even without `"type": "module"` in package.json. |

**ESM compatibility note:** The project uses `tsx` as its runner and `"module": "ES2022"` in tsconfig. ESM-only packages like `ky` work without issues. No need to add `"type": "module"` to package.json -- `tsx` handles this transparently.

## Migration Path

The migration from raw `fetch` to `ky` is minimal:

1. Replace `fetch(url, { method: 'POST', headers, body })` with `ky.post(url, { json: { query, variables } })`
2. Replace `res.json()` with `response.json()` (same API)
3. Remove manual error checking (`if (!res.ok)`) -- ky throws `HTTPError` automatically
4. Remove the try/catch-and-skip pattern in the receipt loop -- ky retries automatically
5. Add a `beforeRetry` hook for CLI logging

The `graphqlRequest` function shrinks from 14 lines to ~3 lines, and gains automatic retry, backoff, and rate limit handling.

## Sources

- [ky GitHub repository](https://github.com/sindresorhus/ky) -- retry options, Retry-After handling, zero-dep confirmation (HIGH confidence)
- [ky retry type definition](https://github.com/sindresorhus/ky/blob/main/source/types/retry.ts) -- methods configuration, POST opt-in verified (HIGH confidence)
- [p-retry GitHub repository](https://github.com/sindresorhus/p-retry) -- API, options, backoff strategy (HIGH confidence)
- [p-retry npm](https://www.npmjs.com/package/p-retry) -- version 7.1.1 confirmed (HIGH confidence)
- [p-queue npm](https://www.npmjs.com/package/p-queue) -- version 9.1.0, evaluated and rejected for this use case (HIGH confidence)
- `npm view ky version engines type` -- version 1.14.3, Node >= 18, ESM only (HIGH confidence, local verification)
- `npm view p-retry version engines type` -- version 7.1.1, Node >= 20, ESM only (HIGH confidence, local verification)
- [How to Handle API Rate Limits Gracefully (2026 Guide)](https://apistatuscheck.com/blog/how-to-handle-api-rate-limits) -- general patterns (MEDIUM confidence)
- [Atlassian: Handling rate limiting in JavaScript](https://www.atlassian.com/blog/developer/handling-rate-limiting-in-javascript) -- patterns and Retry-After parsing (MEDIUM confidence)

---
*Stack research for: Rate limiting and resilient HTTP in Node.js/TypeScript CLI*
*Researched: 2026-03-22*
