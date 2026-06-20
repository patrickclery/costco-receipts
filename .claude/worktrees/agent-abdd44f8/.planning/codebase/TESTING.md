# Testing Patterns

**Analysis Date:** 2026-03-22

## Test Framework

**Status:** No testing framework configured or implemented

**Runner:**
- Not detected. No Jest, Vitest, Mocha, or other test runner configuration present
- No test files in codebase (`.test.ts`, `.spec.ts` files do not exist)

**Assertion Library:**
- Not applicable (no tests)

**Run Commands:**
- No test commands defined in `package.json`
- Only script available: `npm start` → `tsx src/index.ts`

## Test File Organization

**Not applicable** — no tests currently exist in the codebase

**Proposed structure for future tests:**
- Co-locate with source: `src/__tests__/`, `src/module.test.ts` next to `src/module.ts`
- Or separate: `tests/` directory at root level with mirror of `src/` structure

## Test Structure

**Not applicable** — no existing test patterns to document

**When tests are added, recommended pattern:**

```typescript
// Example structure for future tests
describe('fetchReceiptList', () => {
  // Setup/teardown
  beforeEach(() => {
    // Mock API responses
  });

  it('should fetch receipts for date range', async () => {
    // Arrange
    const startDate = new Date('2026-03-01');
    const endDate = new Date('2026-03-22');

    // Act
    const results = await fetchReceiptList(startDate, endDate);

    // Assert
    expect(results).toEqual(/* expected data */);
  });

  it('should handle API errors gracefully', async () => {
    // Test error scenarios
  });
});
```

## Mocking

**Framework:** Not configured

**Recommended approach for future tests:**
- Use `vitest` or `jest` with built-in mocking
- Mock external dependencies: `fetch`, `@actual-app/api`
- Mock file system operations: `fs.readFileSync`, `fs.writeFileSync`, `fs.existsSync`
- Mock environment variables via `process.env`

**Current blocking factors for testing:**
- Direct `fetch()` calls to Costco GraphQL API without abstraction
- Direct `@actual-app/api` calls without service layer abstraction
- File I/O operations intertwined with logic
- No dependency injection pattern

**Example of what to mock:**
```typescript
// Mock external APIs
vi.mock('./costco.ts');
vi.mock('@actual-app/api');

// Mock filesystem
vi.mock('fs');

// Mock environment
process.env.COSTCO_AUTH_TOKEN = 'test-token';
```

## Fixtures and Factories

**Not implemented** — no test data factories exist

**Recommended pattern for future:**
- Create `src/__tests__/fixtures/` directory
- Define test data builders for each type

```typescript
// Example fixture factory pattern
export function createReceiptDetail(overrides?: Partial<ReceiptDetail>): ReceiptDetail {
  return {
    warehouseName: 'Test Warehouse',
    receiptType: 'Purchase',
    documentType: 'WarehouseReceiptDetail',
    transactionDateTime: '2026-03-22T10:00:00Z',
    transactionDate: '2026-03-22',
    // ... other required fields
    ...overrides,
  };
}
```

## Coverage

**Requirements:** None enforced

**No coverage configuration detected** — add coverage reporting when test framework is added

**Recommended setup:**
```bash
vitest --coverage  # When tests are added
```

## Test Types

**Unit Tests:**
- Not implemented
- Should test: `formatDate()`, `titleCase()`, `toInteger()`, `parseArgs()`, `validateEnv()`
- These are pure utility functions suitable for unit testing
- Location: `src/__tests__/utilities.test.ts`

**Integration Tests:**
- Not implemented
- Should test: Costco API integration (`fetchReceiptList`, `fetchReceiptDetail`), Actual API integration (`importReceipts`, `listAccounts`)
- Should mock external APIs but test actual data transformation logic
- Location: `src/__tests__/integration/costco.test.ts`, `src/__tests__/integration/actual.test.ts`

**E2E Tests:**
- Not implemented
- Could test full flow: fetch → transform → import
- Would require test Actual Budget instance or stubbed API
- Location: `tests/e2e/import.e2e.ts`

## Common Patterns

**Async Testing:**
- Currently no async tests exist
- All export functions are async, require testing with `async/await` in tests

**Recommended for future:**
```typescript
describe('fetchAllReceipts', () => {
  it('should fetch all receipts across months', async () => {
    // Mock the graphqlRequest to return test data
    const result = await fetchAllReceipts();
    expect(result.details).toHaveLength(expectedCount);
  });

  it('should retry on rate limit', async () => {
    // Test that sleep(500) delays are respected
  });
});
```

**Error Testing:**
- Error paths not currently tested
- Should test: missing environment variables, API errors, file system errors, malformed API responses

**Recommended approach:**
```typescript
it('should handle fetchReceiptDetail error and continue', async () => {
  // Mock fetch to throw error for one receipt
  const result = await fetchAllReceipts();
  expect(result.details).toHaveLength(totalMinusOne);
  expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringMatching(/ERROR fetching/));
});

it('should throw when required env vars are missing', () => {
  delete process.env.COSTCO_AUTH_TOKEN;
  expect(() => validateEnv(['COSTCO_AUTH_TOKEN'])).toThrow();
});
```

## Blockers for Testing

**Current architecture limitations:**
1. **Tight coupling to external APIs**: `fetch()` calls directly in service functions, no abstraction layer
2. **No dependency injection**: All modules directly import and use external APIs
3. **Mixed concerns**: File I/O, API calls, and business logic in single functions
4. **Global state**: Environment variables read directly in functions via `process.env`
5. **No service interfaces**: Difficult to mock Costco and Actual APIs without refactoring

**Recommended refactoring for testability:**
```typescript
// Create abstraction layer
interface CostcoClient {
  fetchReceiptList(startDate: Date, endDate: Date): Promise<ReceiptSummary[]>;
  fetchReceiptDetail(barcode: string): Promise<ReceiptDetail>;
}

// Inject dependencies
export async function fetchAllReceipts(client: CostcoClient): Promise<...> {
  // Use client instead of direct calls
}
```

---

*Testing analysis: 2026-03-22*
