import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadCheckpoint, saveCheckpoint, CHECKPOINT_FILE, type CheckpointData, type FetchProgress } from './checkpoint.js';

describe('CHECKPOINT_FILE', () => {
  it('equals .costco-checkpoint.json', () => {
    assert.equal(CHECKPOINT_FILE, '.costco-checkpoint.json');
  });
});

describe('FetchProgress type', () => {
  it('has fetched, skipped, failed fields', () => {
    const progress: FetchProgress = { fetched: 1, skipped: 2, failed: 3 };
    assert.equal(progress.fetched, 1);
    assert.equal(progress.skipped, 2);
    assert.equal(progress.failed, 3);
  });
});

describe('CheckpointData type', () => {
  it('has fetchedBarcodes, details, summaries, progress, lastUpdated fields', () => {
    const data: CheckpointData = {
      fetchedBarcodes: ['abc123'],
      details: [],
      summaries: [],
      progress: { fetched: 1, skipped: 0, failed: 0 },
      lastUpdated: '2026-01-01T00:00:00Z',
    };
    assert.deepEqual(data.fetchedBarcodes, ['abc123']);
    assert.deepEqual(data.details, []);
    assert.deepEqual(data.summaries, []);
    assert.equal(data.progress.fetched, 1);
    assert.equal(data.lastUpdated, '2026-01-01T00:00:00Z');
  });
});

describe('loadCheckpoint', () => {
  let originalDir: string;
  let tempDir: string;

  before(() => {
    originalDir = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'checkpoint-test-'));
    process.chdir(tempDir);
  });

  after(() => {
    process.chdir(originalDir);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when no checkpoint file exists', () => {
    const result = loadCheckpoint();
    assert.equal(result, null);
  });

  it('returns parsed CheckpointData when file exists with valid JSON', () => {
    const data: CheckpointData = {
      fetchedBarcodes: ['barcode1', 'barcode2'],
      details: [],
      summaries: [],
      progress: { fetched: 2, skipped: 0, failed: 0 },
      lastUpdated: '2026-01-01T00:00:00Z',
    };
    writeFileSync(CHECKPOINT_FILE, JSON.stringify(data, null, 2));

    const result = loadCheckpoint();
    assert.deepEqual(result, data);
  });

  it('returns null when file contains invalid JSON (corrupted)', () => {
    writeFileSync(CHECKPOINT_FILE, '{invalid json!!!');

    const result = loadCheckpoint();
    assert.equal(result, null);
  });
});

describe('saveCheckpoint', () => {
  let originalDir: string;
  let tempDir: string;

  before(() => {
    originalDir = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'checkpoint-test-'));
    process.chdir(tempDir);
  });

  after(() => {
    process.chdir(originalDir);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes CheckpointData to disk as formatted JSON', () => {
    const data: CheckpointData = {
      fetchedBarcodes: ['abc'],
      details: [],
      summaries: [],
      progress: { fetched: 1, skipped: 0, failed: 0 },
      lastUpdated: '',
    };

    saveCheckpoint(data);

    assert.ok(existsSync(CHECKPOINT_FILE));
    const raw = readFileSync(CHECKPOINT_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed.fetchedBarcodes, ['abc']);
    assert.equal(parsed.progress.fetched, 1);
    // lastUpdated should be set to an ISO string
    assert.ok(parsed.lastUpdated.length > 0, 'lastUpdated should be set');
  });

  it('overwrites existing checkpoint file', () => {
    const data1: CheckpointData = {
      fetchedBarcodes: ['first'],
      details: [],
      summaries: [],
      progress: { fetched: 1, skipped: 0, failed: 0 },
      lastUpdated: '',
    };
    const data2: CheckpointData = {
      fetchedBarcodes: ['second'],
      details: [],
      summaries: [],
      progress: { fetched: 2, skipped: 1, failed: 0 },
      lastUpdated: '',
    };

    saveCheckpoint(data1);
    saveCheckpoint(data2);

    const raw = readFileSync(CHECKPOINT_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed.fetchedBarcodes, ['second']);
    assert.equal(parsed.progress.fetched, 2);
    assert.equal(parsed.progress.skipped, 1);
  });
});
