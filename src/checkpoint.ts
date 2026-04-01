import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { ReceiptDetail, ReceiptSummary } from './types.js';

export const CHECKPOINT_FILE = '.costco-checkpoint.json';

export interface FetchProgress {
  fetched: number;
  skipped: number;
  failed: number;
}

export interface CheckpointData {
  fetchedBarcodes: string[];
  details: ReceiptDetail[];
  summaries: ReceiptSummary[];
  progress: FetchProgress;
  lastUpdated: string;
}

export function loadCheckpoint(): CheckpointData | null {
  if (!existsSync(CHECKPOINT_FILE)) {
    return null;
  }

  try {
    const raw = readFileSync(CHECKPOINT_FILE, 'utf-8');
    return JSON.parse(raw) as CheckpointData;
  } catch {
    return null;
  }
}

export function saveCheckpoint(data: CheckpointData): void {
  data.lastUpdated = new Date().toISOString();
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(data, null, 2));
}
