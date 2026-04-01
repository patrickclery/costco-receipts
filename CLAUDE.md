<!-- GSD:project-start source:PROJECT.md -->
## Project

**Costco Receipts**

A CLI tool that fetches itemized receipt data from costco.ca's GraphQL API and saves it locally as JSON. Receipts can then be imported into Actual Budget as itemized subtransactions, replacing lump-sum Costco purchases with detailed line items for better spending insight.

**Core Value:** Reliably fetch all Costco receipt data end-to-end — handling rate limits gracefully — so every purchase is broken down into individual items.

### Constraints

- **Auth**: Costco API requires manually obtained bearer token and client ID (no OAuth flow)
- **Rate Limits**: Costco API enforces rate limits that must be respected to avoid blocks
- **Dependencies**: Actual Budget server must be running and accessible for import
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.9.3 - Core application logic and type definitions
- JavaScript - Implicit (output targets ES2022)
## Runtime
- Node.js (no specific version enforced)
- npm (implied by package-lock.json presence)
- Lockfile: Present
## Frameworks
- @actual-app/api 26.3.0 - Budget management and transaction import/export
- Built-in Node.js modules (fs, crypto) - File system operations and UUID generation
- tsx 4.21.0 - TypeScript execution runner for development and CLI
- typescript 5.9.3 - Type checking and compilation
## Key Dependencies
- @actual-app/api 26.3.0 - Provides SDK for connecting to Actual Budget server, importing transactions, and managing accounts
- dotenv 17.3.1 - Environment variable loading from .env files
- @types/node 25.5.0 - Node.js type definitions
## Configuration
- Configuration via .env file (see .env.example)
- Required environment variables:
- tsconfig.json: ES2022 target, strict mode enabled
- Output: ES2022 modules with bundler resolution
## Platform Requirements
- Node.js (no minimum version specified)
- npm for package management
- Unix-like environment (Bash/Zsh scripting in src)
- Node.js runtime
- Actual Budget server instance accessible at ACTUAL_SERVER_URL
- Network access to Costco GraphQL API (ecom-api.costco.com)
- Temporary cache directory at `/tmp/actual-costco-cache` (or configurable)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- lowercase with hyphens for multi-word names (e.g., `costco-receipts.json`)
- `.ts` extension for TypeScript modules
- Purpose-based naming: `types.ts`, `index.ts`, service-focused names like `costco.ts`, `actual.ts`
- camelCase for all function names
- Examples: `parseArgs()`, `validateEnv()`, `fetchReceiptList()`, `formatDate()`, `buildHeaders()`, `titleCase()`
- Async functions clearly named with verbs: `connectActual()`, `importReceipts()`, `shutdownActual()`, `fetchAllReceipts()`
- camelCase for all variable declarations: `DATA_FILE`, `startDate`, `endDate`, `accountId`
- SCREAMING_SNAKE_CASE for constants that are string URLs or config values: `GRAPHQL_URL`, `LIST_QUERY`, `DETAIL_QUERY`
- Descriptive names reflecting data type/purpose: `allSummaries`, `warehouseReceipts`, `allDetails`, `subtransactions`
- PascalCase for all interface names: `ReceiptSummary`, `ReceiptDetail`, `ItemDetail`, `TenderDetail`, `SubTaxes`, `ReceiptListResponse`, `ReceiptDetailResponse`
- Suffix naming pattern: `-Response` for API response types, `-Detail` for detailed records, `-Summary` for summary records
- All types exported with `export interface`
## Code Style
- No explicit linter/formatter configured (not detected)
- Consistent indentation: 2 spaces observed throughout codebase
- Line length: no observed hard limit, pragmatic wrapping
- Brace style: opening brace on same line (Allman style avoided)
- TypeScript strict mode enabled in `tsconfig.json`
- Compiler options: `"strict": true`
- No external linting rules (ESLint/Biome not configured)
## Import Organization
- Not used; relative imports with `.js` extensions throughout (ESM-compatible)
## Error Handling
- Validation functions check preconditions: `validateEnv()` checks required environment variables and exits with `process.exit(1)` on failure
- Try-catch for API calls: `fetchAllReceipts()` wraps detail fetching in try-catch, logs errors with context, continues processing on failure
- Error messages are descriptive: `console.error('Missing env vars: ${missing.join(', ')}')`
- Graceful degradation in async operations: failed receipt fetches don't stop the entire import
## Logging
- `console.log()` for informational messages with context about operations in progress
- `console.error()` for errors and validation failures
- Prefixed with spacing/markers for clarity: `"  Fetching receipts..."`, `"  Found ${receipts.length} receipts"`, `"--- Summary ---"`
- Progress messages include data context: file names, counts, dates, amounts
- Operations report start, progress, and completion
## Comments
- Minimal comments; code is largely self-documenting
- Comments explain "why" for non-obvious logic, not "what"
- Comments mark section boundaries: `// --- Costco API Types ---`
- Comments clarify business logic: `// Filter to warehouse receipts only for detail fetch`
- Comments explain return value handling: `// YYYY-MM-DD format`
- Not used in this codebase
- Function purposes are evident from names and TypeScript types
## Function Design
- Explicit parameter types required (TypeScript strict mode)
- No parameter destructuring observed; simple parameters preferred
- Helper functions like `buildHeaders()` and `formatDate()` extracted for reusability
- Explicit return types declared on all functions
- Async functions return `Promise<T>` where T is the data type
- Functions that perform side effects return `Promise<void>`
- Functions returning structured data use typed interfaces
## Module Design
- Named exports preferred: `export async function`, `export interface`
- One responsibility per module: `costco.ts` handles Costco API, `actual.ts` handles Actual Budget integration, `types.ts` contains all types
- All public functions explicitly exported
- Not used; `types.ts` serves as type export source
- Direct imports from specific modules enforced
- CLI argument parsing
- Environment validation
- Orchestration of fetch → import flow
- File I/O for caching receipt data
- Costco GraphQL API requests
- Receipt list and detail fetching
- Date formatting for API calls
- Rate limiting via `sleep(500)` between requests
- Actual Budget API integration
- Transaction transformation and formatting
- Import and listing operations
- Account management
- All TypeScript interfaces for API schemas
- Response types for both Costco and Actual
- Item, tender, and tax detail types
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Sequential data pipeline: fetch → transform → import
- Three independent but coordinated subsystems: Costco API client, data types, Actual Budget importer
- CLI-driven orchestration with environment-based configuration
- Pluggable architecture allowing fetch-only and import-only modes
## Layers
- Purpose: Parse arguments, validate environment, coordinate data flow between systems
- Location: `src/index.ts`
- Contains: Main entry point, CLI flag parsing, file I/O, data pipeline orchestration
- Depends on: `costco.ts` for fetching, `actual.ts` for importing, `types.ts` for data structures
- Used by: Direct execution via `npm start`
- Purpose: Handle authenticated communication with external services (Costco GraphQL API and Actual Budget SDK)
- Location: `src/costco.ts` (Costco API), `src/actual.ts` (Actual Budget API)
- Contains: GraphQL request builders, authentication headers, API response parsing, rate limiting (sleep calls)
- Depends on: `types.ts` for type definitions, external libraries (@actual-app/api, fetch API)
- Used by: Orchestration layer calls fetch functions and import functions
- Purpose: Define all TypeScript interfaces representing Costco API responses and Actual Budget transaction format
- Location: `src/types.ts`
- Contains: ReceiptSummary, ReceiptDetail, ItemDetail, TenderDetail, and all intermediate API response structures
- Depends on: No internal dependencies
- Used by: Both API layers and orchestration layer for type safety
## Data Flow
- On successful fetch: write full API response to `costco-receipts.json`
- On import-only mode: read previously saved `costco-receipts.json`
- No database; all state is transient except saved JSON backup
- Minimal state: CLI flags and environment variables only
- No persistent in-memory state between operations
- API responses are transformation targets, not stored internally
- Actual Budget SDK handles all connection state via `api.init()` / `api.shutdown()`
## Key Abstractions
- Purpose: Model the transformation of Costco receipt data into Actual Budget transaction format
- Examples: `ReceiptSummary` → `ReceiptDetail` → transaction object
- Pattern: Composed interfaces where ReceiptDetail embeds ItemDetail, TenderDetail, and SubTaxes arrays
- Purpose: Encapsulate header construction and token injection for Costco API
- Examples: `buildHeaders()` function injects `COSTCO_AUTH_TOKEN` and `COSTCO_CLIENT_ID`
- Pattern: Environment variable injection at request time, not at initialization
- Purpose: Hide GraphQL query structure from orchestration layer
- Examples: `LIST_QUERY` and `DETAIL_QUERY` constants define field selections
- Pattern: Hardcoded query strings with variable placeholders, type-safe response parsing
- Purpose: Convert between Costco's floating-point dollars and Actual Budget's integer-cent representation
- Examples: `toInteger()` function in `src/actual.ts` multiplies by 100 and rounds
- Pattern: Single utility function to ensure consistency across all transactions
## Entry Points
- Location: `src/index.ts` main()
- Triggers: `npm start [flags]`
- Responsibilities: Parse arguments, validate environment, orchestrate data flow, handle errors
- Location: `src/index.ts` lines 42-66
- Triggers: `npm start` or `npm start --fetch-only`
- Responsibilities: Fetch receipts from Costco API, save to JSON, print summary, exit
- Location: `src/index.ts` lines 31-38
- Triggers: `npm start --list-accounts`
- Responsibilities: Connect to Actual Budget, list available accounts, exit
- Location: `src/index.ts` lines 42-66 (read from JSON) + 68-84 (import flow)
- Triggers: `npm start --import-only --account=<ID>`
- Responsibilities: Read saved JSON, validate account selection, import to Actual Budget
- Location: `src/index.ts` lines 52-84 (combined)
- Triggers: `npm start --account=<ID>` (no flags, default behavior)
- Responsibilities: Fetch fresh data from Costco, save JSON, then import to Actual Budget
## Error Handling
- Missing env vars: `validateEnv()` checks all required vars upfront and exits with list
- Costco API errors: GraphQL responses wrapped in try/catch with original error message logged
- File not found: Explicit check for `costco-receipts.json` with helpful message suggesting `--fetch-only`
- Account validation: Explicit check for `--account=<ID>` flag with list accounts suggestion
- Fatal errors: Caught in `main().catch()` and logged before exit(1)
## Cross-Cutting Concerns
- Receipt list fetching with date ranges and counts
- Detail fetching progress per receipt
- Import completion with added/updated counts
- Error messages prefixed with context (e.g., "ERROR fetching {barcode}")
- Environment variable validation at start of each mode
- GraphQL response structure validation (accessing nested properties, assumes correct shape)
- Date format validation: `transactionDate` assumed YYYY-MM-DD format from API
- Amount validation: Assumes numeric fields are valid floats/integers from API
- Costco API: Bearer token + client ID in custom headers
- Actual Budget: Password-based auth via `api.init()` with server URL and budget ID
- Credentials stored in `.env` file (not committed)
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
