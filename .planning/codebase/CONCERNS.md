# Codebase Concerns

**Analysis Date:** 2026-03-22

## Tech Debt

**Missing Input Validation:**
- Issue: GraphQL responses are parsed without schema validation. Array access `[0]` on receipt detail response assumes non-empty array
- Files: `src/costco.ts:209`, `src/index.ts:49`
- Impact: Crashes if API returns empty array or unexpected structure. JSON.parse can throw but is not explicitly handled
- Fix approach: Validate GraphQL responses match expected types before accessing fields. Add guard clauses for array indexing

**Hardcoded Temporary Directory:**
- Issue: Actual Budget API cache is hardcoded to `/tmp/actual-costco-cache`
- Files: `src/actual.ts:6`
- Impact: Data persists in `/tmp` which may be cleared by system. Not portable across systems/environments
- Fix approach: Use platform-agnostic temp directory via `os.tmpdir()` or make configurable

**Non-null Assertion Operators:**
- Issue: Environment variables accessed with TypeScript non-null assertions (`!`) without runtime validation
- Files: `src/actual.ts:7-8,11`, `src/costco.ts:148-149`
- Impact: Type checker bypassed. If env vars missing, code crashes at runtime despite `validateEnv()` checks existing
- Fix approach: Validate env vars early, then use type-safe getters. Or use utilities that guarantee non-null

**Date String Parsing:**
- Issue: Date string split by 'T' with no validation that format matches
- Files: `src/costco.ts:241`
- Impact: Malformed dates from API could cause undefined/incorrect date parsing
- Fix approach: Use proper ISO 8601 date parsing library or validate format

## Error Handling Gaps

**Silent API Failures in Loop:**
- Issue: When fetching receipt details in loop, individual fetch failures are caught and logged but don't prevent continuation
- Files: `src/costco.ts:243-248`
- Impact: User may not realize some receipts failed to import. Silent data loss
- Fix approach: Collect failure list and report summary at end. Consider retry logic for transient failures

**Unvalidated GraphQL Response Structure:**
- Issue: GraphQL responses lack type guards. If API returns `errors` field or null, code doesn't check
- Files: `src/costco.ts:166-179`
- Impact: Passing invalid data downstream. Type assertion `as T` bypasses validation
- Fix approach: Check for GraphQL errors in response before returning

**Incomplete Enum Handling:**
- Issue: `transactionType` checked only for 'Refund', other types assumed to be expenses
- Files: `src/actual.ts:34`
- Impact: Unknown transaction types silently treated as expenses. No validation of allowed values
- Fix approach: Validate against exhaustive list of known types

## Data Integrity Risks

**No Duplicate Handling Between Fetches:**
- Issue: `fetchAllReceipts()` accumulates receipts across 3-month windows in a loop without checking for duplicates within a single run
- Files: `src/costco.ts:228`
- Impact: If same receipt appears in two date ranges, it gets imported twice. Relies solely on Actual Budget dedup via `imported_id`
- Fix approach: Track barcodes within fetch session to prevent duplicates

**Floating Point Math in Financial Amounts:**
- Issue: Amounts are converted to integers for Actual Budget but original floating point values used in calculations
- Files: `src/actual.ts:24,42,50,57`
- Impact: Rounding errors possible though unlikely at currency precision. Better to avoid float arithmetic entirely
- Fix approach: Use decimal library or keep as cents throughout

**Missing Tax Calculation Validation:**
- Issue: Tax is added as separate subtransaction but no validation that `subTotal + taxes = total`
- Files: `src/actual.ts:38-53`
- Impact: Data integrity issue if Costco API returns inconsistent data (though unlikely)
- Fix approach: Assert subtotal math adds up before importing

## Security Considerations

**Hardcoded User-Agent:**
- Issue: User-Agent header is hardcoded to specific Firefox version
- Files: `src/costco.ts:160`
- Impact: If Costco detects this pattern, could be rate-limited or blocked as bot
- Fix approach: Randomize or use real browser user-agent rotation

**Bearer Token in Env Var:**
- Issue: Authentication token stored in plaintext in `.env` file
- Files: `.env.example`
- Impact: If .env committed or leaked, full account access compromised
- Fix approach: Document secure storage practices. Add to .gitignore verification in CI

**No Rate Limiting:**
- Issue: API requests made in tight loop with only 500ms sleep
- Files: `src/costco.ts:230,249`
- Impact: Could trigger rate limits or block from Costco. Could be IP-banned
- Fix approach: Implement exponential backoff on 429 responses

**Sensitive Data in Logs:**
- Issue: Receipt details logged to console including potentially sensitive data
- Files: `src/costco.ts:242`
- Impact: If logs captured, contains shopping history and merchant info
- Fix approach: Redact sensitive fields in log output

## Known Limitations

**Warehouse Receipts Only:**
- Issue: Gas station, car wash receipts fetched but not processed for import
- Files: `src/costco.ts:235-237`
- Impact: User data loss - non-warehouse transactions silently ignored
- Fix approach: Support gas/car wash imports or warn user about filtered data

**No Support for Cancelled Transactions:**
- Issue: No special handling for cancelled status or negative amounts
- Files: `src/actual.ts:35`
- Impact: Refunds handled via type flag but cancelled/void not distinguished
- Fix approach: Check for negative amounts and handle as refunds/reversals

**Costco API Dependency:**
- Issue: Entire import depends on private Costco GraphQL API with no documentation
- Files: `src/costco.ts:4-143`
- Impact: If API changes or is blocked, entire tool breaks with no migration path
- Fix approach: Monitor API changes. Consider web scraping fallback for receipts

## Test Coverage Gaps

**No Tests:**
- Issue: Zero test coverage for critical data transformation and API integration
- Files: All files in `src/`
- Risk: Refactoring, dependency updates, or API changes cause silent data corruption
- Priority: **High** - Financial data tool needs comprehensive tests
- Missing coverage:
  - Date parsing and formatting
  - Amount conversion and sign handling
  - GraphQL response parsing
  - Refund vs expense logic
  - Receipt deduplication
  - CSV/transaction structure validation

**No Integration Tests:**
- Issue: No test against mock Actual Budget or Costco API
- Files: `src/costco.ts`, `src/actual.ts`
- Risk: Breaking changes in dependencies discovered only in production
- Priority: **High** - Would catch API contract breakage

**No Input Validation Tests:**
- Issue: No tests for malformed dates, missing fields, wrong types
- Files: `src/index.ts`, `src/costco.ts`
- Risk: Edge cases cause crashes with poor error messages
- Priority: **Medium** - User-facing errors need graceful handling

## Performance Considerations

**Sequential Receipt Detail Fetches:**
- Issue: Receipt details fetched one at a time in a loop with 500ms delay
- Files: `src/costco.ts:240-250`
- Impact: Importing 100 receipts takes ~50 seconds. For large transaction histories, very slow
- Improvement path: Implement batch fetching if API supports it, or parallel fetches with rate limit control

**No Caching Between Runs:**
- Issue: Full historical re-fetch every run despite saving JSON backup
- Files: `src/index.ts:43-61`
- Impact: If import fails midway, next run re-fetches all data
- Improvement path: Store fetch metadata (last run date, receipts fetched) to skip already-imported data

**Monthly Window Sliding:**
- Issue: Fetches 3-month windows that slide backwards indefinitely
- Files: `src/costco.ts:219-231`
- Impact: Could fetch very old data repeatedly. Costco may reject requests for ancient dates
- Improvement path: Add max history limit (e.g., 12 months) or detect when no new receipts appear

## Scaling Limits

**Single-Threaded Blocking Operations:**
- Issue: All I/O is sequential: fetch summaries → fetch details → import to Actual
- Files: `src/costco.ts:240-250`, `src/actual.ts:65`
- Current capacity: Practical limit ~200-300 receipts per run
- Limit: Beyond that, timeout risks increase
- Scaling path: Use Promise.all() with concurrency control for fetches. Batch import transactions

**Memory Accumulation:**
- Issue: All receipt details loaded into memory before import
- Files: `src/costco.ts:239`
- Current capacity: Likely fine for typical user (100-500 receipts)
- Limit: Very large histories (5000+ receipts) could hit memory limits
- Scaling path: Stream processing instead of accumulation

**Actual Budget API Rate Limits:**
- Issue: No rate limiting on import transaction batch
- Files: `src/actual.ts:65`
- Current capacity: Unknown, likely generous for single user
- Limit: Unknown Actual Budget limits
- Scaling path: Implement request batching and retry with exponential backoff

## Dependencies at Risk

**@actual-app/api Dependency:**
- Risk: Undocumented API. Version specified with `^26.3.0` allows breaking changes
- Impact: Minor version bumps could break transaction import format
- Migration plan: Pin exact version. Monitor release notes. Add integration tests

**No Type Checking on External API:**
- Risk: Costco GraphQL API could change field names, types, or add required fields
- Impact: Silent data corruption or import failures
- Migration plan: Add runtime schema validation. Consider schema registry

**Dotenv Only for Development:**
- Risk: Production deployment unclear - where do env vars come from?
- Impact: Could fail to start in production if vars not available
- Migration plan: Document production environment setup

## Architecture Concerns

**Tight Coupling to Actual Budget:**
- Issue: All transaction transformation logic is Actual Budget-specific
- Files: `src/actual.ts:31-63`
- Impact: Adding support for other budget apps requires major refactoring
- Fix approach: Extract transaction model into generic shape. Make Actual a plugin

**Unidirectional Data Flow Assumption:**
- Issue: No conflict detection if user edits transaction in Actual Budget before next import
- Files: `src/actual.ts:59` (uses `imported_id` for dedup)
- Impact: User edits could be overwritten by next import if dedup fails
- Fix approach: Track last sync timestamp. Warn if transaction was modified since import

**Command-Line Interface Fragility:**
- Issue: Argument parsing is string-based and fragile
- Files: `src/index.ts:9-16`
- Impact: Typos in flags cause silent failures. Multiple conflicting flags handled ungracefully
- Fix approach: Use proper CLI library (yargs, commander, etc.)

---

*Concerns audit: 2026-03-22*
