# Coding Conventions

**Analysis Date:** 2026-03-22

## Naming Patterns

**Files:**
- lowercase with hyphens for multi-word names (e.g., `costco-receipts.json`)
- `.ts` extension for TypeScript modules
- Purpose-based naming: `types.ts`, `index.ts`, service-focused names like `costco.ts`, `actual.ts`

**Functions:**
- camelCase for all function names
- Examples: `parseArgs()`, `validateEnv()`, `fetchReceiptList()`, `formatDate()`, `buildHeaders()`, `titleCase()`
- Async functions clearly named with verbs: `connectActual()`, `importReceipts()`, `shutdownActual()`, `fetchAllReceipts()`

**Variables:**
- camelCase for all variable declarations: `DATA_FILE`, `startDate`, `endDate`, `accountId`
- SCREAMING_SNAKE_CASE for constants that are string URLs or config values: `GRAPHQL_URL`, `LIST_QUERY`, `DETAIL_QUERY`
- Descriptive names reflecting data type/purpose: `allSummaries`, `warehouseReceipts`, `allDetails`, `subtransactions`

**Types:**
- PascalCase for all interface names: `ReceiptSummary`, `ReceiptDetail`, `ItemDetail`, `TenderDetail`, `SubTaxes`, `ReceiptListResponse`, `ReceiptDetailResponse`
- Suffix naming pattern: `-Response` for API response types, `-Detail` for detailed records, `-Summary` for summary records
- All types exported with `export interface`

## Code Style

**Formatting:**
- No explicit linter/formatter configured (not detected)
- Consistent indentation: 2 spaces observed throughout codebase
- Line length: no observed hard limit, pragmatic wrapping
- Brace style: opening brace on same line (Allman style avoided)

**Linting:**
- TypeScript strict mode enabled in `tsconfig.json`
- Compiler options: `"strict": true`
- No external linting rules (ESLint/Biome not configured)

## Import Organization

**Order:**
1. External package imports (`import { ... } from 'package-name'`)
2. Type imports (`import type { ... } from './types.js'`)
3. Relative module imports (`import { ... } from './module.js'`)
4. Config/constants defined inline

**Examples from codebase:**
```typescript
// src/index.ts
import 'dotenv/config';  // Side-effect import first
import { writeFileSync, readFileSync, existsSync } from 'fs';  // Node builtins
import { fetchAllReceipts } from './costco.js';  // Relative imports
import { connectActual, listAccounts, importReceipts, shutdownActual } from './actual.js';
import type { ReceiptDetail } from './types.js';  // Type imports last
```

**Path Aliases:**
- Not used; relative imports with `.js` extensions throughout (ESM-compatible)

## Error Handling

**Patterns:**
- Validation functions check preconditions: `validateEnv()` checks required environment variables and exits with `process.exit(1)` on failure
- Try-catch for API calls: `fetchAllReceipts()` wraps detail fetching in try-catch, logs errors with context, continues processing on failure
- Error messages are descriptive: `console.error('Missing env vars: ${missing.join(', ')}')`
- Graceful degradation in async operations: failed receipt fetches don't stop the entire import

**Example from `src/costco.ts`:**
```typescript
try {
  const detail = await fetchReceiptDetail(receipt.transactionBarcode);
  allDetails.push(detail);
} catch (err) {
  console.error(`  ERROR fetching ${receipt.transactionBarcode}: ${err}`);
}
```

**Example from `src/index.ts`:**
```typescript
function validateEnv(keys: string[]) {
  const missing = keys.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in values.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

## Logging

**Framework:** `console` only (no structured logging library)

**Patterns:**
- `console.log()` for informational messages with context about operations in progress
- `console.error()` for errors and validation failures
- Prefixed with spacing/markers for clarity: `"  Fetching receipts..."`, `"  Found ${receipts.length} receipts"`, `"--- Summary ---"`
- Progress messages include data context: file names, counts, dates, amounts
- Operations report start, progress, and completion

**Examples:**
```typescript
console.log(`  Fetching receipts ${variables.startDate} – ${variables.endDate}...`);
console.log(`  Found ${receipts.length} receipts (warehouse: ${counts.inWarehouse}, gas: ${counts.gasStation})`);
console.log(`\nTotal receipts found: ${allSummaries.length}`);
console.error(`  ERROR fetching ${receipt.transactionBarcode}: ${err}`);
```

## Comments

**When to Comment:**
- Minimal comments; code is largely self-documenting
- Comments explain "why" for non-obvious logic, not "what"
- Comments mark section boundaries: `// --- Costco API Types ---`
- Comments clarify business logic: `// Filter to warehouse receipts only for detail fetch`
- Comments explain return value handling: `// YYYY-MM-DD format`

**JSDoc/TSDoc:**
- Not used in this codebase
- Function purposes are evident from names and TypeScript types

**Example:**
```typescript
// Filter to warehouse receipts only for detail fetch
const warehouseReceipts = allSummaries.filter(r => r.documentType === 'WarehouseReceiptDetail');
```

## Function Design

**Size:** Functions are kept small (under 20 lines typical), single-responsibility

**Parameters:**
- Explicit parameter types required (TypeScript strict mode)
- No parameter destructuring observed; simple parameters preferred
- Helper functions like `buildHeaders()` and `formatDate()` extracted for reusability

**Return Values:**
- Explicit return types declared on all functions
- Async functions return `Promise<T>` where T is the data type
- Functions that perform side effects return `Promise<void>`
- Functions returning structured data use typed interfaces

**Examples:**
```typescript
async function graphqlRequest<T>(query: string, variables: Record<string, string>): Promise<T>
async function fetchAllReceipts(): Promise<{ summaries: ReceiptSummary[]; details: ReceiptDetail[] }>
function formatDate(d: Date): string
function validateEnv(keys: string[]): void  // Side-effect function
```

## Module Design

**Exports:**
- Named exports preferred: `export async function`, `export interface`
- One responsibility per module: `costco.ts` handles Costco API, `actual.ts` handles Actual Budget integration, `types.ts` contains all types
- All public functions explicitly exported

**Barrel Files:**
- Not used; `types.ts` serves as type export source
- Direct imports from specific modules enforced

**Module Responsibilities:**

`src/index.ts`:
- CLI argument parsing
- Environment validation
- Orchestration of fetch → import flow
- File I/O for caching receipt data

`src/costco.ts`:
- Costco GraphQL API requests
- Receipt list and detail fetching
- Date formatting for API calls
- Rate limiting via `sleep(500)` between requests

`src/actual.ts`:
- Actual Budget API integration
- Transaction transformation and formatting
- Import and listing operations
- Account management

`src/types.ts`:
- All TypeScript interfaces for API schemas
- Response types for both Costco and Actual
- Item, tender, and tax detail types

---

*Convention analysis: 2026-03-22*
