# Phase 1: HTTP Resilience - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-22
**Phase:** 01-http-resilience
**Areas discussed:** HTTP client choice, Retry behavior, Error messaging

---

## HTTP Client Choice

| Option | Description | Selected |
|--------|-------------|----------|
| Use ky (Recommended) | Drop-in fetch wrapper with built-in retry, backoff, Retry-After parsing. Zero deps, 3KB. graphqlRequest() shrinks from 14 lines to ~3. | ✓ |
| Build on raw fetch | Keep zero new deps. Write custom retry/backoff wrapper around native fetch. More code but no external dependency. | |
| You decide | Claude picks the best approach for this codebase | |

**User's choice:** Use ky (Recommended)
**Notes:** None

### Follow-up: Scope of ky usage

| Option | Description | Selected |
|--------|-------------|----------|
| GraphQL wrapper only | Replace graphqlRequest() internals. Keep the same exported function signatures. Minimal change surface. | |
| Full replacement | Use ky.create() instance throughout. All HTTP calls go through ky. Consistent retry behavior everywhere. | ✓ |

**User's choice:** Full replacement
**Notes:** None

---

## Retry Behavior

### Base delay between requests

| Option | Description | Selected |
|--------|-------------|----------|
| 2 seconds (Recommended) | Conservative default. Research suggests this avoids Akamai escalation from 429 to 403 account block. | |
| 1.5 seconds | Slightly faster. May still trigger occasional 429s but ky handles those with retry. | |
| 3 seconds | Very conservative. Slower but safest for undocumented API. | ✓ |

**User's choice:** 3 seconds
**Notes:** User prefers safest option for undocumented API

### Handling exhausted retries

| Option | Description | Selected |
|--------|-------------|----------|
| Skip and continue | Log the failed receipt, move to the next one. Fetch as many as possible in one run. | |
| Stop the run | Halt the entire fetch. User investigates and retries manually. | |
| You decide | Claude picks based on the error type | ✓ |

**User's choice:** You decide
**Notes:** Claude decides based on error type

---

## Error Messaging

### Retry/error output detail level

| Option | Description | Selected |
|--------|-------------|----------|
| Informative (Recommended) | Show retry count, wait duration, and error type. e.g., 'Rate limited, retrying in 8.3s (attempt 2/5)' | ✓ |
| Minimal | Just show errors and final outcomes. No retry progress. | |
| Verbose | Show full HTTP status, headers, response body on error. Good for debugging. | |

**User's choice:** Informative (Recommended)
**Notes:** None

### 401 (expired token) message style

| Option | Description | Selected |
|--------|-------------|----------|
| Actionable message | e.g., 'Auth token expired. Get a new one from costco.ca DevTools > Network > copy costco-x-authorization header' | ✓ |
| Simple message | e.g., 'Authentication failed (401). Please update COSTCO_AUTH_TOKEN in your .env file.' | |
| You decide | Claude writes the most helpful message | |

**User's choice:** Actionable message
**Notes:** None

---

## Claude's Discretion

- Exact ky configuration options
- Jitter on base inter-request delay
- client-identifier UUID strategy (per-session vs per-request)
- Exact error message wording

## Deferred Ideas

None — discussion stayed within phase scope
