# Architecture

**Analysis Date:** 2026-03-22

## Pattern Overview

**Overall:** Three-Layer CLI Application with External API Integration

**Key Characteristics:**
- Sequential data pipeline: fetch → transform → import
- Three independent but coordinated subsystems: Costco API client, data types, Actual Budget importer
- CLI-driven orchestration with environment-based configuration
- Pluggable architecture allowing fetch-only and import-only modes

## Layers

**CLI Orchestration Layer:**
- Purpose: Parse arguments, validate environment, coordinate data flow between systems
- Location: `src/index.ts`
- Contains: Main entry point, CLI flag parsing, file I/O, data pipeline orchestration
- Depends on: `costco.ts` for fetching, `actual.ts` for importing, `types.ts` for data structures
- Used by: Direct execution via `npm start`

**External API Integration Layer:**
- Purpose: Handle authenticated communication with external services (Costco GraphQL API and Actual Budget SDK)
- Location: `src/costco.ts` (Costco API), `src/actual.ts` (Actual Budget API)
- Contains: GraphQL request builders, authentication headers, API response parsing, rate limiting (sleep calls)
- Depends on: `types.ts` for type definitions, external libraries (@actual-app/api, fetch API)
- Used by: Orchestration layer calls fetch functions and import functions

**Data Model Layer:**
- Purpose: Define all TypeScript interfaces representing Costco API responses and Actual Budget transaction format
- Location: `src/types.ts`
- Contains: ReceiptSummary, ReceiptDetail, ItemDetail, TenderDetail, and all intermediate API response structures
- Depends on: No internal dependencies
- Used by: Both API layers and orchestration layer for type safety

## Data Flow

**Fetch Flow (Costco API):**

1. User runs with `--fetch-only` or without `--import-only`
2. `main()` calls `fetchAllReceipts()` in `src/costco.ts`
3. `fetchAllReceipts()` loops through date ranges calling `fetchReceiptList()`
4. Each `fetchReceiptList()` makes GraphQL request to `GRAPHQL_URL` with LIST_QUERY
5. Parse response and extract warehouse receipts
6. For each warehouse receipt, call `fetchReceiptDetail()` to get full item/tender details
7. Return aggregated `{ summaries, details }` object
8. Orchestration layer saves raw response to `costco-receipts.json` as backup

**Import Flow (Actual Budget):**

1. User runs with account ID: `--account=<ID>`
2. `main()` calls `connectActual()` to initialize SDK connection
3. `importReceipts()` transforms receipt details into Actual Budget transaction format:
   - Convert amounts from dollars to integers (cents)
   - Create subtransactions for each item line + tax
   - Extract warehouse location as payee name
   - Deduplicate using transaction barcode as `imported_id`
4. Call `api.importTransactions()` which handles deduplication server-side
5. Display summary of added/updated transactions
6. Call `shutdownActual()` to close connection

**File I/O:**

- On successful fetch: write full API response to `costco-receipts.json`
- On import-only mode: read previously saved `costco-receipts.json`
- No database; all state is transient except saved JSON backup

**State Management:**
- Minimal state: CLI flags and environment variables only
- No persistent in-memory state between operations
- API responses are transformation targets, not stored internally
- Actual Budget SDK handles all connection state via `api.init()` / `api.shutdown()`

## Key Abstractions

**Receipt Pipeline:**
- Purpose: Model the transformation of Costco receipt data into Actual Budget transaction format
- Examples: `ReceiptSummary` → `ReceiptDetail` → transaction object
- Pattern: Composed interfaces where ReceiptDetail embeds ItemDetail, TenderDetail, and SubTaxes arrays

**API Authentication:**
- Purpose: Encapsulate header construction and token injection for Costco API
- Examples: `buildHeaders()` function injects `COSTCO_AUTH_TOKEN` and `COSTCO_CLIENT_ID`
- Pattern: Environment variable injection at request time, not at initialization

**GraphQL Abstraction:**
- Purpose: Hide GraphQL query structure from orchestration layer
- Examples: `LIST_QUERY` and `DETAIL_QUERY` constants define field selections
- Pattern: Hardcoded query strings with variable placeholders, type-safe response parsing

**Amount Conversion:**
- Purpose: Convert between Costco's floating-point dollars and Actual Budget's integer-cent representation
- Examples: `toInteger()` function in `src/actual.ts` multiplies by 100 and rounds
- Pattern: Single utility function to ensure consistency across all transactions

## Entry Points

**CLI Execution:**
- Location: `src/index.ts` main()
- Triggers: `npm start [flags]`
- Responsibilities: Parse arguments, validate environment, orchestrate data flow, handle errors

**Fetch-Only Mode:**
- Location: `src/index.ts` lines 42-66
- Triggers: `npm start` or `npm start --fetch-only`
- Responsibilities: Fetch receipts from Costco API, save to JSON, print summary, exit

**List Accounts Mode:**
- Location: `src/index.ts` lines 31-38
- Triggers: `npm start --list-accounts`
- Responsibilities: Connect to Actual Budget, list available accounts, exit

**Import-Only Mode:**
- Location: `src/index.ts` lines 42-66 (read from JSON) + 68-84 (import flow)
- Triggers: `npm start --import-only --account=<ID>`
- Responsibilities: Read saved JSON, validate account selection, import to Actual Budget

**Import with Fresh Fetch:**
- Location: `src/index.ts` lines 52-84 (combined)
- Triggers: `npm start --account=<ID>` (no flags, default behavior)
- Responsibilities: Fetch fresh data from Costco, save JSON, then import to Actual Budget

## Error Handling

**Strategy:** Fail-fast with descriptive error messages

**Patterns:**
- Missing env vars: `validateEnv()` checks all required vars upfront and exits with list
- Costco API errors: GraphQL responses wrapped in try/catch with original error message logged
- File not found: Explicit check for `costco-receipts.json` with helpful message suggesting `--fetch-only`
- Account validation: Explicit check for `--account=<ID>` flag with list accounts suggestion
- Fatal errors: Caught in `main().catch()` and logged before exit(1)

## Cross-Cutting Concerns

**Logging:** Console-based logging at key pipeline stages:
- Receipt list fetching with date ranges and counts
- Detail fetching progress per receipt
- Import completion with added/updated counts
- Error messages prefixed with context (e.g., "ERROR fetching {barcode}")

**Validation:**
- Environment variable validation at start of each mode
- GraphQL response structure validation (accessing nested properties, assumes correct shape)
- Date format validation: `transactionDate` assumed YYYY-MM-DD format from API
- Amount validation: Assumes numeric fields are valid floats/integers from API

**Authentication:**
- Costco API: Bearer token + client ID in custom headers
- Actual Budget: Password-based auth via `api.init()` with server URL and budget ID
- Credentials stored in `.env` file (not committed)

---

*Architecture analysis: 2026-03-22*
