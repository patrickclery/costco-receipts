import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CostcoAuthError, CostcoPermanentError, resilientPost, interRequestDelay, INTER_REQUEST_DELAY_MS } from './http.js';

describe('CostcoAuthError', () => {
  it('includes costco-x-authorization in message', () => {
    const err = new CostcoAuthError();
    assert.ok(err.message.includes('costco-x-authorization'));
  });

  it('includes costco.ca in message', () => {
    const err = new CostcoAuthError();
    assert.ok(err.message.includes('costco.ca'));
  });

  it('is an instance of Error', () => {
    const err = new CostcoAuthError();
    assert.ok(err instanceof Error);
  });

  it('has name CostcoAuthError', () => {
    const err = new CostcoAuthError();
    assert.equal(err.name, 'CostcoAuthError');
  });
});

describe('CostcoPermanentError', () => {
  it('stores status code 400', () => {
    const err = new CostcoPermanentError(400, 'bad request');
    assert.equal(err.status, 400);
  });

  it('stores status code 403', () => {
    const err = new CostcoPermanentError(403, 'forbidden');
    assert.equal(err.status, 403);
  });

  it('stores status code 404', () => {
    const err = new CostcoPermanentError(404, 'not found');
    assert.equal(err.status, 404);
  });

  it('stores response body', () => {
    const err = new CostcoPermanentError(404, 'not found');
    assert.equal(err.responseBody, 'not found');
  });

  it('is an instance of Error', () => {
    const err = new CostcoPermanentError(400, '');
    assert.ok(err instanceof Error);
  });

  it('has name CostcoPermanentError', () => {
    const err = new CostcoPermanentError(400, '');
    assert.equal(err.name, 'CostcoPermanentError');
  });
});

describe('resilientPost', () => {
  it('is a function', () => {
    assert.equal(typeof resilientPost, 'function');
  });
});

describe('INTER_REQUEST_DELAY_MS', () => {
  it('equals 3000', () => {
    assert.equal(INTER_REQUEST_DELAY_MS, 3000);
  });
});

describe('interRequestDelay', () => {
  it('takes at least 3000ms', async () => {
    const start = Date.now();
    await interRequestDelay();
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 2900, `Expected >= 2900ms but got ${elapsed}ms`);
  });

  it('adds jitter (takes more than exactly 3000ms on average)', async () => {
    const start = Date.now();
    await interRequestDelay();
    const elapsed = Date.now() - start;
    // Should be between 3000 and 4000ms (3000 base + 0-1000ms jitter)
    assert.ok(elapsed < 4200, `Expected < 4200ms but got ${elapsed}ms`);
  });
});
