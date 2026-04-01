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

const TRANSIENT_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 5;

/**
 * Resilient HTTP POST with retry, backoff, and error classification.
 * Replaces ky — uses raw fetch which works reliably with Costco's Akamai CDN.
 */
export async function resilientPost(url: string, options: { body: string; headers: Record<string, string> }): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: options.headers,
        body: options.body,
      });
    } catch (err) {
      // Network error (DNS, connection reset, etc.)
      if (attempt < MAX_RETRIES) {
        const delay = backoffDelay(attempt);
        console.log(`  Network error, retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }

    // 401 = expired token, halt immediately
    if (response.status === 401) {
      throw new CostcoAuthError();
    }

    // 400/403/404 = permanent errors, don't retry
    if ([400, 403, 404].includes(response.status)) {
      const body = await response.text().catch(() => '');
      throw new CostcoPermanentError(response.status, body);
    }

    // Transient errors — retry with backoff
    if (TRANSIENT_CODES.has(response.status)) {
      if (attempt < MAX_RETRIES) {
        // Check for Retry-After header
        const retryAfter = response.headers.get('retry-after');
        let delay: number;
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          delay = isNaN(parsed) ? backoffDelay(attempt) : Math.min(parsed * 1000, 120_000);
        } else {
          delay = backoffDelay(attempt);
        }
        console.log(`  Rate limited (HTTP ${response.status}), retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      const body = await response.text().catch(() => '');
      throw new Error(`Costco API ${response.status} after ${MAX_RETRIES} retries: ${body}`);
    }

    // Success
    return response;
  }

  throw new Error('Unreachable');
}

/** Exponential backoff with full jitter. Base 2s, cap 60s. */
function backoffDelay(attempt: number): number {
  const base = 2000;
  const cap = 60_000;
  const exponential = Math.min(cap, base * Math.pow(2, attempt));
  return Math.random() * exponential;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Base delay between sequential API requests (milliseconds). D-04: 3s conservative. */
export const INTER_REQUEST_DELAY_MS = 3000;

/**
 * Wait between sequential API requests to avoid triggering rate limits.
 * Adds random jitter (0-1000ms) on top of the base 3s delay.
 */
export async function interRequestDelay(): Promise<void> {
  const delay = INTER_REQUEST_DELAY_MS + Math.random() * 1000;
  await new Promise(resolve => setTimeout(resolve, delay));
}
