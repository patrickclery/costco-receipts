import ky from 'ky';

/**
 * Thrown on 401 responses -- indicates the Costco auth token has expired.
 * Message includes actionable instructions for obtaining a new token.
 */
export class CostcoAuthError extends Error {
  constructor() {
    super(
      `Costco auth token expired. To get a new token:\n` +
      `  1. Open https://www.costco.ca in your browser and log in\n` +
      `  2. Open DevTools (F12) -> Network tab\n` +
      `  3. Click any receipt on the Receipts page\n` +
      `  4. Find a request to ecom-api.costco.com\n` +
      `  5. Copy the 'costco-x-authorization' header value\n` +
      `  6. Update COSTCO_AUTH_TOKEN in your .env file`
    );
    this.name = 'CostcoAuthError';
  }
}

/**
 * Thrown on 400, 403, 404 responses -- permanent errors that should not be retried.
 * Includes the HTTP status code and response body for diagnostics.
 */
export class CostcoPermanentError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    super(`Costco API permanent error ${status}: ${responseBody}`);
    this.name = 'CostcoPermanentError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

/**
 * Pre-configured ky instance for all Costco API calls.
 *
 * Retry policy:
 * - Up to 5 attempts on transient errors (408, 429, 500, 502, 503, 504)
 * - POST method enabled (GraphQL queries are read-only and safe to retry)
 * - Exponential backoff capped at 60s
 * - Retry-After header respected (capped at 2 minutes)
 *
 * Error classification (via beforeError hook):
 * - 401 -> CostcoAuthError (halt immediately, token expired)
 * - 400/403/404 -> CostcoPermanentError (don't retry)
 * - 408/429/5xx -> retried automatically by ky
 */
export const costcoApi = ky.create({
  retry: {
    limit: 5,                                        // D-06: max 5 attempts
    methods: ['post'],                               // GraphQL uses POST, safe to retry (read-only queries)
    statusCodes: [408, 429, 500, 502, 503, 504],     // D-08: transient errors
    backoffLimit: 60_000,                            // D-05: cap at 60s
    maxRetryAfter: 120_000,                          // Don't wait more than 2min on Retry-After
  },
  timeout: 30_000,                                   // 30s per request
  hooks: {
    beforeRetry: [
      ({ retryCount }) => {
        // D-11/UX-02: Log retry with count and wait duration
        // ky provides retryCount (1-based attempt number)
        // Calculate the approximate delay for display using ky's default formula
        const baseDelay = 2000;        // D-05: base 2s
        const maxDelay = 60_000;
        const exponentialDelay = Math.min(maxDelay, baseDelay * Math.pow(2, retryCount - 1));
        const jitteredDelay = Math.random() * exponentialDelay;
        const displaySeconds = (jitteredDelay / 1000).toFixed(1);
        console.log(`  Rate limited, retrying in ${displaySeconds}s (attempt ${retryCount}/5)`);
      },
    ],
    beforeError: [
      async (error) => {
        const { response } = error;
        if (response) {
          if (response.status === 401) {
            throw new CostcoAuthError();
          }
          if ([400, 403, 404].includes(response.status)) {
            const body = await response.text().catch(() => '');
            throw new CostcoPermanentError(response.status, body);
          }
        }
        return error;
      },
    ],
  },
});

/** Base delay between sequential API requests (milliseconds). D-04: 3s conservative. */
export const INTER_REQUEST_DELAY_MS = 3000;

/**
 * Wait between sequential API requests to avoid triggering rate limits.
 * Adds random jitter (0-1000ms) on top of the base 3s delay.
 */
export async function interRequestDelay(): Promise<void> {
  // Add jitter: 3000ms + random 0-1000ms
  const delay = INTER_REQUEST_DELAY_MS + Math.random() * 1000;
  await new Promise(resolve => setTimeout(resolve, delay));
}
