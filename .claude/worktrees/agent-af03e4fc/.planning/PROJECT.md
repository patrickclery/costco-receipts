# Costco Receipts

## What This Is

A CLI tool that fetches itemized receipt data from costco.ca's GraphQL API and saves it locally as JSON. Receipts can then be imported into Actual Budget as itemized subtransactions, replacing lump-sum Costco purchases with detailed line items for better spending insight.

## Core Value

Reliably fetch all Costco receipt data end-to-end — handling rate limits gracefully — so every purchase is broken down into individual items.

## Requirements

### Validated

- ✓ Fetch receipt summaries from Costco GraphQL API — existing
- ✓ Fetch detailed receipt data (items, tenders, taxes) — existing
- ✓ Save raw receipt data to local JSON file — existing
- ✓ Import receipts into Actual Budget as itemized subtransactions — existing
- ✓ CLI modes: fetch-only, import-only, list-accounts, combined — existing
- ✓ Environment-based configuration via .env — existing
- ✓ Deduplication via transaction barcode as imported_id — existing

### Active

- [ ] Handle Costco API rate limiting with retry/backoff so fetching completes reliably
- [ ] Resume interrupted fetches without re-fetching already-retrieved receipts

### Out of Scope

- Mobile app — CLI is sufficient
- Other retailers — Costco-only tool
- Real-time sync — batch fetch is fine

## Context

- TypeScript CLI app using tsx for execution
- Costco's ecom-api.costco.com GraphQL endpoint requires bearer token + client ID
- Actual Budget integration via @actual-app/api SDK
- Rate limiting from Costco API has been blocking full receipt fetches
- User already has Costco purchases imported as lump sums in Actual Budget; goal is to itemize them
- No test suite currently exists

## Constraints

- **Auth**: Costco API requires manually obtained bearer token and client ID (no OAuth flow)
- **Rate Limits**: Costco API enforces rate limits that must be respected to avoid blocks
- **Dependencies**: Actual Budget server must be running and accessible for import

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Local JSON as intermediate format | Allows fetch and import to run independently; acts as backup | ✓ Good |
| GraphQL direct integration | Costco has no public API; scraping the internal GraphQL endpoint | ⚠️ Revisit — fragile, may break |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-22 after initialization*
