# External Integrations

**Analysis Date:** 2026-03-22

## APIs & External Services

**Costco Receipt API:**
- Costco GraphQL API - Fetches receipt summaries and details for Costco transactions
  - Endpoint: `https://ecom-api.costco.com/ebusiness/order/v1/orders/graphql`
  - SDK/Client: Native fetch (no SDK)
  - Auth: Custom headers with bearer token
    - `costco-x-authorization` - Bearer token from `COSTCO_AUTH_TOKEN`
    - `costco-x-wcs-clientId` - Client ID from `COSTCO_CLIENT_ID`
  - Additional Headers:
    - `costco.service: restOrders`
    - `costco.env: ecom`
    - `client-identifier` - Random UUID per request
    - Standard browser headers (User-Agent, Origin, Referer)

**Actual Budget API:**
- Actual Budget Server - Personal finance management and transaction import
  - Location: `src/actual.ts`
  - SDK/Client: @actual-app/api
  - Auth: Server password authentication
    - `ACTUAL_PASSWORD` - Password for Actual instance
    - `ACTUAL_BUDGET_ID` - Budget identifier
  - Key Functions:
    - `api.init()` - Initialize connection to server
    - `api.downloadBudget()` - Load budget data
    - `api.getAccounts()` - List available accounts for import
    - `api.importTransactions()` - Import transactions with deduplication
    - `api.shutdown()` - Close connection

## Data Storage

**Databases:**
- None directly integrated - Actual Budget manages persistent storage on its server

**File Storage:**
- Local filesystem only
  - Cache: `/tmp/actual-costco-cache` - Temporary cache for Actual Budget API
  - JSON dump: `costco-receipts.json` - Local backup of fetched receipt data

**Caching:**
- None (beyond temporary Actual Budget cache)

## Authentication & Identity

**Auth Provider:**
- Custom/Manual - No OAuth or identity provider
  - Costco: Bearer token obtained from browser DevTools (developer extracts from network requests)
  - Actual: Password-based authentication to self-hosted server

## Monitoring & Observability

**Error Tracking:**
- None - Errors logged to console

**Logs:**
- Console-based (console.log, console.error)
  - Progress messages during receipt fetching
  - Transaction import summaries
  - Error messages for API failures
  - No persistent logging

## CI/CD & Deployment

**Hosting:**
- Not applicable - Command-line tool, runs locally

**CI Pipeline:**
- None detected

## Environment Configuration

**Required env vars:**
- `COSTCO_AUTH_TOKEN` - Bearer token for Costco API
- `COSTCO_CLIENT_ID` - Costco client identifier (UUID format)
- `ACTUAL_SERVER_URL` - Base URL of Actual Budget server
- `ACTUAL_PASSWORD` - Password for Actual Budget account
- `ACTUAL_BUDGET_ID` - Budget ID in Actual instance

**Secrets location:**
- `.env` file (git-ignored, not committed)
- Template provided in `.env.example`

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

## API Query Patterns

**Costco GraphQL Queries:**
- `receiptsWithCounts` - List receipts within date range
  - Parameters: startDate, endDate, documentType, documentSubType
  - Paginated via date range walking (3-month windows)
  - Rate limiting: 500ms delay between requests

- `receiptsWithCounts` (detail) - Fetch receipt details
  - Parameters: barcode, documentType
  - Includes full item details, taxes, and tender information
  - Rate limiting: 500ms delay between requests

**Actual Transaction Import:**
- Transactional format: Date, amount, payee, deduplication ID, notes, subtransactions
- Subtransaction split for line items and tax
- Automatic deduplication by `imported_id` (Costco barcode)

---

*Integration audit: 2026-03-22*
