<p align="center">
  <img src="docs/logo.svg" alt="Costco Receipts" width="600">
</p>

A CLI tool that fetches itemized receipt data from costco.ca's GraphQL API and saves it as JSON. Replaces lump-sum Costco purchases with detailed line items — every item, price, tax, and tender broken out.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your Costco credentials (see [Getting Your Token](#getting-your-token) below).

## Usage

### Fetch all receipts

```bash
npm start -- --fetch-only
```

This fetches every warehouse receipt from your Costco account and saves them to `costco-receipts.json`.

The tool:
- Fetches receipt summaries in 3-month windows going back until no more are found
- Fetches itemized details for each warehouse receipt
- Waits 3 seconds between requests to respect rate limits
- Saves a checkpoint after each receipt — if interrupted, the next run resumes where it left off
- If your token expires mid-fetch, prompts you to paste a new one and continues automatically

### Output

`costco-receipts.json` contains all receipt data with full item details:

```json
{
  "summaries": [...],
  "details": [
    {
      "warehouseName": "MONTREAL",
      "transactionDate": "2026-03-27",
      "total": 56.89,
      "totalItemCount": 6,
      "itemArray": [
        {
          "itemDescription01": "CLEMENTINES",
          "amount": 9.99,
          "unit": 1,
          "taxFlag": "N"
        }
      ],
      "tenderArray": [...],
      "subTaxes": [...]
    }
  ]
}
```

### Import to Actual Budget (optional)

If you use [Actual Budget](https://actualbudget.org/), you can import receipts as itemized subtransactions:

```bash
# List available accounts
npm start -- --list-accounts

# Import receipts to a specific account
npm start -- --account=<ACCOUNT_ID>

# Fetch + import in one step
npm start -- --account=<ACCOUNT_ID>

# Import from previously saved JSON only
npm start -- --import-only --account=<ACCOUNT_ID>
```

## Getting Your Token

Costco doesn't have a public API. The tool uses the same GraphQL endpoint as the costco.ca website, which requires a bearer token from your browser session.

1. Log into [costco.ca](https://www.costco.ca)
2. Go to **Account** > **Orders & Purchases** > **Warehouse** tab
3. Open browser DevTools (`F12`) > **Network** tab
4. Click **View Receipt** on any receipt
5. Find a request to `ecom-api.costco.com` in the network log
6. Copy the `costco-x-authorization` header value (starts with `Bearer eyJ...`)
7. Paste it as `COSTCO_AUTH_TOKEN` in your `.env` file

Tokens expire after ~15 minutes. If the token expires during a fetch, the tool will prompt you to paste a new one and resume automatically.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `COSTCO_AUTH_TOKEN` | Yes | Bearer token from costco.ca DevTools |
| `COSTCO_CLIENT_ID` | Yes | Client ID from costco.ca DevTools (`costco-x-wcs-clientId` header) |
| `ACTUAL_SERVER_URL` | For import | URL of your Actual Budget server |
| `ACTUAL_PASSWORD` | For import | Actual Budget password |
| `ACTUAL_BUDGET_ID` | For import | Budget ID in Actual Budget |

## Resilience Features

- **Retry with backoff** — Transient errors (429, 5xx) retry up to 5 times with exponential backoff and jitter
- **Retry-After support** — Respects the server's Retry-After header when present
- **Error classification** — 401 halts immediately (expired token), 400/403/404 skip that receipt, transient errors retry
- **Checkpoint/resume** — Progress saved after each receipt; interrupted fetches resume without re-fetching
- **Graceful shutdown** — Ctrl+C saves progress before exiting
- **Token prompt** — When a token expires mid-fetch, prompts for a new one interactively

## Running Tests

```bash
npm test
```

## Project Structure

```
src/
  index.ts        CLI entry point, argument parsing, orchestration
  costco.ts       Costco GraphQL API client (list + detail queries)
  http.ts         Resilient HTTP layer (retry, backoff, error classification)
  checkpoint.ts   Checkpoint read/write for resumable fetches
  actual.ts       Actual Budget API integration
  types.ts        TypeScript interfaces for API responses
```
