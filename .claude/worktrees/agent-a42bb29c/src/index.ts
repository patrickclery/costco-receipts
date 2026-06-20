import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { fetchAllReceipts } from './costco.js';
import { connectActual, listAccounts, importReceipts, shutdownActual } from './actual.js';
import type { ReceiptDetail } from './types.js';

const DATA_FILE = 'costco-receipts.json';

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
    const result = await fetchAllReceipts();
    details = result.details;

    // Save raw data as backup
    writeFileSync(DATA_FILE, JSON.stringify(result, null, 2));
    console.log(`\nSaved raw data to ${DATA_FILE}`);
  }

  if (flags.fetchOnly) {
    printSummary(details);
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

  printSummary(details);
}

function printSummary(details: ReceiptDetail[]) {
  const totalItems = details.reduce((sum, r) => sum + Math.abs(r.totalItemCount), 0);
  const totalAmount = details.reduce((sum, r) => sum + r.total, 0);
  console.log(`\n--- Summary ---`);
  console.log(`Receipts: ${details.length}`);
  console.log(`Items:    ${totalItems}`);
  console.log(`Total:    $${totalAmount.toFixed(2)}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
