# Requirements: Costco Receipts

**Defined:** 2026-03-22
**Core Value:** Reliably fetch all Costco receipt data end-to-end — handling rate limits gracefully — so every purchase is broken down into individual items.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Retry & Backoff

- [x] **RETRY-01**: Tool retries failed requests with exponential backoff and full jitter (base 2s, cap 60s)
- [x] **RETRY-02**: Tool respects Retry-After header from 429 responses, falling back to calculated backoff when absent
- [x] **RETRY-03**: Tool classifies errors as transient (429, 500, 502, 503, 504, network errors) or permanent (400, 401, 403, 404) and only retries transient errors
- [x] **RETRY-04**: Tool bails immediately on 401 with clear message telling user to refresh their Costco auth token
- [x] **RETRY-05**: Tool caps retries at 5 attempts per request before failing that request

### Resilience

- [ ] **RESL-01**: Tool tracks which receipt barcodes have been fetched and skips them on re-run
- [ ] **RESL-02**: Tool saves fetch progress to disk so interrupted runs can resume without re-fetching
- [ ] **RESL-03**: Tool handles SIGINT (Ctrl+C) gracefully by saving current progress before exiting
- [ ] **RESL-04**: Tool handles SIGTERM gracefully by saving current progress before exiting

### UX

- [ ] **UX-01**: Tool displays progress counter during fetch (e.g., `[12/47] Fetching receipt...`)
- [x] **UX-02**: Tool logs retry attempts with wait duration (e.g., `Rate limited, retrying in 8.3s (attempt 2/5)`)
- [ ] **UX-03**: Tool displays summary on completion showing total fetched, skipped (already had), and failed

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### CLI Ergonomics

- **CLI-01**: User can filter fetch by date range (`--since`, `--until`)
- **CLI-02**: User can configure request delay via `--delay <ms>` flag
- **CLI-03**: User can set verbosity level (`--verbose`, `--quiet`)
- **CLI-04**: User can preview what would be fetched without making API calls (`--dry-run`)

### Robustness

- **ROBU-01**: Tool writes receipts to JSON incrementally as each is fetched (crash-safe)
- **ROBU-02**: Tool detects token expiry early and warns user before wasting retries

## Out of Scope

| Feature | Reason |
|---------|--------|
| Parallel/concurrent fetching | Will worsen rate limiting on undocumented API; Akamai may block |
| Automatic token refresh | No public OAuth; headless browser automation is fragile and may violate ToS |
| Database storage | Over-engineering for single-user CLI; JSON is sufficient |
| Scheduled/cron execution | Token expires and must be manually refreshed |
| Web UI / dashboard | Actual Budget provides the visualization layer |
| Proxy rotation | Personal tool for own data; adversarial techniques risk account flags |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RETRY-01 | Phase 1 | Complete |
| RETRY-02 | Phase 1 | Complete |
| RETRY-03 | Phase 1 | Complete |
| RETRY-04 | Phase 1 | Complete |
| RETRY-05 | Phase 1 | Complete |
| UX-02 | Phase 1 | Complete |
| RESL-01 | Phase 2 | Pending |
| RESL-02 | Phase 2 | Pending |
| RESL-03 | Phase 2 | Pending |
| RESL-04 | Phase 2 | Pending |
| UX-01 | Phase 2 | Pending |
| UX-03 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after roadmap creation*
