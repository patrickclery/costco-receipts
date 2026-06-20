import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { fetchAllReceipts } from './costco.js';
import { CostcoAuthError } from './http.js';
import { loadCheckpoint, CHECKPOINT_FILE, type FetchProgress } from './checkpoint.js';
import { connectActual, listAccounts, importReceipts, shutdownActual } from './actual.js';
import type { ReceiptDetail } from './types.js';

const DATA_FILE = 'costco-receipts.json';

function handleShutdown(signal: string): void {
  console.log(`\n${signal} received. Saving progress...`);
  const checkpoint = loadCheckpoint();
  if (checkpoint) {
    console.log(`Progress saved in ${CHECKPOINT_FILE} (${checkpoint.progress.fetched} fetched, ${checkpoint.progress.failed} failed).`);
    console.log('Re-run to resume from checkpoint.');
  } else {
    console.log('No progress to save (no receipts fetched yet).');
  }
  process.exit(0);
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    fetchOnly: args.includes('--fetch-only'),
    importOnly: args.includes('--import-only'),
    accountId: args.find(a => a.startsWith('--account='))?.split('=')[1],
    listAccounts: args.includes('--list-accounts'),
  };
}

function validateEnv(keys: string[]) {
  const missing = keys.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in values.');
    process.exit(1);
  }
}

async function main() {
  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  const flags = parseArgs();

  // --list-accounts: just show available accounts and exit
  if (flags.listAccounts) {
    validateEnv(['ACTUAL_SERVER_URL', 'ACTUAL_PASSWORD', 'ACTUAL_BUDGET_ID']);
    await connectActual();
    await listAccounts();
    await shutdownActual();
    return;
  }

  let details: ReceiptDetail[];
  let progress: FetchProgress | undefined;

  if (flags.importOnly) {
    // Read from saved JSON
    if (!existsSync(DATA_FILE)) {
      console.error(`${DATA_FILE} not found. Run --fetch-only first.`);
      process.exit(1);
    }
    console.log(`Reading receipts from ${DATA_FILE}...`);
    const saved = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
    details = saved.details;
    console.log(`Loaded ${details.length} receipts from file.`);
  } else {
    // Fetch from Costco API
    validateEnv(['COSTCO_AUTH_TOKEN', 'COSTCO_CLIENT_ID']);
    const existingCheckpoint = loadCheckpoint();
    if (existingCheckpoint) {
      console.log(`Resuming from checkpoint: ${existingCheckpoint.progress.fetched} already fetched.`);
    }
    try {
      const result = await fetchAllReceipts();
      details = result.details;
      progress = result.progress;

      // Save raw data as backup
      writeFileSync(DATA_FILE, JSON.stringify(result, null, 2));
      console.log(`\nSaved raw data to ${DATA_FILE}`);

      // Clean up checkpoint after successful full fetch
      try {
        unlinkSync(CHECKPOINT_FILE);
      } catch {
        // Ignore if file doesn't exist
      }
    } catch (err) {
      if (err instanceof CostcoAuthError) {
        console.error(`\n${err.message}`);
        process.exit(1);
      }
      throw err; // Re-throw non-auth errors for the outer main().catch() handler
    }
  }

  if (flags.fetchOnly) {
    printSummary(details, progress);
    return;
  }

  // Import to Actual Budget
  validateEnv(['ACTUAL_SERVER_URL', 'ACTUAL_PASSWORD', 'ACTUAL_BUDGET_ID']);

  if (!flags.accountId) {
    console.error('\nNo account specified. Use --account=<ID> to set the target account.');
    console.error('Run with --list-accounts to see available accounts.\n');
    await connectActual();
    await listAccounts();
    await shutdownActual();
    process.exit(1);
  }

  await connectActual();
  await importReceipts(details, flags.accountId);
  await shutdownActual();

  printSummary(details, progress);
}

function printSummary(details: ReceiptDetail[], progress?: FetchProgress): void {
  const totalItems = details.reduce((sum, r) => sum + Math.abs(r.totalItemCount), 0);
  const totalAmount = details.reduce((sum, r) => sum + r.total, 0);
  console.log(`\n--- Summary ---`);
  console.log(`Receipts: ${details.length}`);
  console.log(`Items:    ${totalItems}`);
  console.log(`Total:    $${totalAmount.toFixed(2)}`);
  if (progress) {
    console.log(`Fetched:  ${progress.fetched}`);
    console.log(`Skipped:  ${progress.skipped}`);
    console.log(`Failed:   ${progress.failed}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
