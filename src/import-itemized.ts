import 'dotenv/config';
import { readFileSync } from 'fs';
import * as api from '@actual-app/api';
import type { ReceiptDetail } from './types.js';

const ACCOUNT_ID = '7779f231-b6c7-4353-a5d5-8feda153d04a';

const DEPT_CATEGORY: Record<number, string> = {
  65: 'Grocery', 17: 'Grocery', 13: 'Grocery', 12: 'Grocery',
  14: 'Grocery', 18: 'Grocery', 19: 'Grocery', 62: 'Grocery',
  0: 'General', 93: 'General',
  39: 'Home', 23: 'Home',
  20: 'Medical', 34: 'Medical', 94: 'Medical',
  26: 'Computer', 27: 'Clothes', 25: 'Car',
  24: 'Entertainment', 31: 'Baby', 16: 'Pets',
};

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

async function main() {
  // 1. Load receipt data
  const data = JSON.parse(readFileSync('costco-receipts.json', 'utf-8'));
  const receipts: ReceiptDetail[] = data.details;
  console.log(`Loaded ${receipts.length} receipts from costco-receipts.json`);

  // 2. Connect to Actual Budget
  await api.init({
    dataDir: '/tmp/actual-costco-cache',
    serverURL: process.env.ACTUAL_SERVER_URL!,
    password: process.env.ACTUAL_PASSWORD!,
  });
  await api.downloadBudget(process.env.ACTUAL_BUDGET_ID!);
  console.log('Connected to Actual Budget');

  // 3. Build category lookup
  const categories = await api.getCategories();
  const catByName = new Map(categories.map(c => [c.name, c.id]));

  function getCategoryId(dept: number): string | undefined {
    const name = DEPT_CATEGORY[dept];
    return name ? catByName.get(name) : undefined;
  }

  // 4. Get existing Costco transactions from the account
  const existingTxns = await api.getTransactions(ACCOUNT_ID, '2023-01-01', '2027-01-01');
  const costcoTxns = existingTxns.filter(
    (t: any) => (t.notes || '').toLowerCase().includes('costco') ||
                (t.imported_payee || '').toLowerCase().includes('costco')
  );
  console.log(`Found ${costcoTxns.length} existing Costco transactions`);

  // 5. Build match index: date + absolute amount in cents
  // Existing txns have negative amounts for purchases (outflow)
  const matchIndex = new Map<string, any>();
  for (const txn of costcoTxns) {
    const key = `${txn.date}:${Math.abs(txn.amount)}`;
    if (!matchIndex.has(key)) {
      matchIndex.set(key, txn);
    }
  }

  // 6. Process each receipt
  let matched = 0;
  let unmatched = 0;
  let skipped = 0;

  let processed = 0;
  for (const receipt of receipts) {
    const isRefund = receipt.transactionType === 'Refund';
    const amountCents = Math.round(Math.abs(receipt.total) * 100);
    const date = receipt.transactionDate;
    const key = `${date}:${amountCents}`;

    // Separate real items from fees (deposits/enviro) that reference a parent item
    const sign = isRefund ? 1 : -1;
    const feePattern = /(?:DEPOSIT|ENVIRO FEE)\s.*(?:VL|CL)\/(\d+)/i;
    const realItems: typeof receipt.itemArray = [];
    const feesByParent = new Map<string, number>();

    for (const item of receipt.itemArray) {
      const desc = (item.itemDescription01 || '').trim();
      const match = desc.match(feePattern);
      if (match) {
        const parentNum = match[1];
        feesByParent.set(parentNum, (feesByParent.get(parentNum) || 0) + Math.round(item.amount * 100));
      } else {
        realItems.push(item);
      }
    }

    // Build subtransactions with fees and tax distributed into each item
    const taxCents = Math.round((receipt.taxes || 0) * 100);
    const subtotalCents = realItems.reduce((s, item) => s + Math.round(item.amount * 100), 0);
    let taxDistributed = 0;

    const subtransactions = realItems.map((item, i) => {
      let itemCents = Math.round(item.amount * 100);
      // Add deposits/enviro fees that belong to this item
      const fee = feesByParent.get(item.itemNumber);
      if (fee) itemCents += fee;
      // Distribute tax proportionally
      if (taxCents !== 0 && subtotalCents !== 0) {
        const isLast = i === realItems.length - 1;
        const itemTax = isLast
          ? taxCents - taxDistributed
          : Math.round((itemCents / subtotalCents) * taxCents);
        taxDistributed += itemTax;
        itemCents += itemTax;
      }
      return {
        amount: itemCents * sign,
        notes: `${(item.itemDescription01 || 'Unknown').trim()} (#${item.itemNumber})`,
        category: getCategoryId(item.itemDepartmentNumber),
      };
    });

    const existingTxn = matchIndex.get(key);

    if (existingTxn) {
      // Delete the existing transaction and re-import with subtransactions
      await api.deleteTransaction(existingTxn.id);
      await api.importTransactions(ACCOUNT_ID, [{
        account: ACCOUNT_ID,
        date,
        amount: existingTxn.amount,
        payee_name: `Costco ${titleCase(receipt.warehouseName)}`,
        imported_id: existingTxn.imported_id || `costco:${receipt.transactionBarcode}`,
        notes: `Costco ${titleCase(receipt.warehouseName)} — ${receipt.totalItemCount} items`,
        subtransactions,
      }]);
      matched++;
      console.log(`  Updated: ${date} $${receipt.total} (${receipt.totalItemCount} items)`);

      // Remove from index so duplicate amounts on same date match 1:1
      matchIndex.delete(key);
    } else {
      // No matching transaction — import as new
      await api.importTransactions(ACCOUNT_ID, [{
        account: ACCOUNT_ID,
        date,
        amount: Math.round(receipt.total * 100) * sign,
        payee_name: `Costco ${titleCase(receipt.warehouseName)}`,
        imported_id: `costco:${receipt.transactionBarcode}`,
        notes: `Costco ${titleCase(receipt.warehouseName)} — ${receipt.totalItemCount} items`,
        subtransactions,
      }]);
      unmatched++;
      console.log(`  Imported: ${date} $${receipt.total} (${receipt.totalItemCount} items) [NEW]`);
    }

    // Sync every 20 receipts to avoid massive sync at shutdown
    processed++;
    if (processed % 20 === 0) {
      await api.sync();
      console.log(`  (synced ${processed}/${receipts.length})`);
    }
  }

  console.log(`\n--- Import Summary ---`);
  console.log(`Matched & updated: ${matched}`);
  console.log(`Imported as new:   ${unmatched}`);
  console.log(`Skipped (already): ${skipped}`);

  await api.shutdown();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
