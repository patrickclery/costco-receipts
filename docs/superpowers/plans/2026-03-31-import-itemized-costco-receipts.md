# Import Itemized Costco Receipts Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace lump-sum Costco transactions in Actual Budget with itemized subtransactions from `costco-receipts.json`, with each item categorized.

**Architecture:** Read existing Costco transactions from Actual Budget via the HTTP API (`actual-api` container at `http://172.20.0.2:5007`). Match each receipt from `costco-receipts.json` to an existing transaction by date + amount. For each match, update the transaction to add subtransactions (one per item + tax) with category assignments based on Costco department codes. Unmatched receipts get imported as new transactions.

**Tech Stack:** TypeScript, `@actual-app/api`, Node.js, `costco-receipts.json`

**Key data:**
- Actual Budget API: `http://172.20.0.2:5007` with key `openclaw-budget-access-key-2026`
- Budget sync ID: `e4c1a783-98c1-4fcc-b04b-44457b0e62a6`
- Rogers Mastercard account: `7779f231-b6c7-4353-a5d5-8feda153d04a`
- 267 existing Costco lump-sum transactions (no subtransactions)
- 223 itemized receipts in `costco-receipts.json`

**Category mapping (Costco dept → Actual category name):**

| Dept | Category |
|------|----------|
| 65, 17, 13, 12, 14, 18, 19, 62 | Grocery |
| 0, 93 | General |
| 39, 23 | Home |
| 20, 34, 94 | Medical |
| 26 | Computer |
| 27 | Clothes |
| 25 | Car |
| 24 | Entertainment |
| 31 | Baby |
| 16 | Pets |
| (tax line) | Taxes |

---

### Task 1: Create the matching and import script

**Files:**
- Create: `src/import-itemized.ts`

- [ ] **Step 1: Create the import script**

```typescript
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

  for (const receipt of receipts) {
    const isRefund = receipt.transactionType === 'Refund';
    const amountCents = Math.round(Math.abs(receipt.total) * 100);
    const date = receipt.transactionDate;
    const key = `${date}:${amountCents}`;

    // Build subtransactions
    const sign = isRefund ? 1 : -1;
    const subtransactions = receipt.itemArray.map(item => ({
      amount: Math.round(item.amount * 100) * sign,
      notes: `${(item.itemDescription01 || 'Unknown').trim()} (#${item.itemNumber})`,
      category_id: getCategoryId(item.itemDepartmentNumber),
    }));

    // Add tax subtransaction
    if (receipt.taxes && receipt.taxes !== 0) {
      subtransactions.push({
        amount: Math.round(receipt.taxes * 100) * sign,
        notes: 'Tax',
        category_id: catByName.get('Taxes'),
      });
    }

    const existingTxn = matchIndex.get(key);

    if (existingTxn) {
      // Skip if already has subtransactions (already itemized)
      if (existingTxn.subtransactions && existingTxn.subtransactions.length > 0) {
        skipped++;
        continue;
      }

      // Update existing transaction with subtransactions
      await api.updateTransaction(existingTxn.id, {
        notes: `Costco ${titleCase(receipt.warehouseName)} — ${receipt.totalItemCount} items`,
        subtransactions,
      });
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/import-itemized.ts
git commit -m "feat: add script to import itemized Costco receipts into Actual Budget"
```

---

### Task 2: Add npm script and run the import

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the import script to package.json**

In `package.json` `scripts` section, add:

```json
"import-itemized": "tsx src/import-itemized.ts"
```

- [ ] **Step 2: Run a dry check — verify connection and matching**

Before running, verify the matching logic will work by checking a few transactions:

Run: `npm run import-itemized`

Expected output:
```
Loaded 223 receipts from costco-receipts.json
Connected to Actual Budget
Found ~267 existing Costco transactions
  Updated: 2026-03-27 $56.89 (6 items)
  Updated: 2026-03-25 $17.22 (2 items)
  ...
--- Import Summary ---
Matched & updated: ~XXX
Imported as new:   ~XXX
Skipped (already): 0
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add import-itemized npm script"
```

---

### Task 3: Verify in Actual Budget

- [ ] **Step 1: Spot-check a few transactions via API**

Pick a known receipt (e.g., 2026-03-27 MONTREAL $56.89 with 6 items) and verify it now has subtransactions:

```bash
curl -s "http://172.20.0.2:5007/v1/budgets/e4c1a783-98c1-4fcc-b04b-44457b0e62a6/accounts/7779f231-b6c7-4353-a5d5-8feda153d04a/transactions?since_date=2026-03-27" \
  -H "x-api-key: openclaw-budget-access-key-2026" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      const r=JSON.parse(d);
      const t=r.data.find(t=>t.date==='2026-03-27' && t.is_parent);
      if(t){
        console.log('Transaction:', t.date, t.amount, t.notes);
        console.log('Subtransactions:', t.subtransactions.length);
        t.subtransactions.forEach(s=>console.log(' ',s.amount, s.notes));
      } else { console.log('No matching parent transaction found'); }
    });
"
```

Expected: Transaction shows 6 subtransactions (CLEMENTINES, BANANAS, etc.) with category assignments.

- [ ] **Step 2: Open Actual Budget UI and verify visually**

Open Actual Budget in browser. Navigate to Rogers Mastercard account. Find a recent Costco transaction and confirm:
- It shows as a split transaction with individual items
- Each item has a category assigned
- Amounts sum correctly to the total

---

## Notes

- **Matching strategy:** Date + absolute amount in cents. This handles most cases since Costco charges appear on the credit card on the same date as the receipt. If a match fails (timing differences between receipt date and bank posting date), the receipt imports as a new transaction.
- **Duplicate safety:** Transactions already itemized (has subtransactions) are skipped. New imports use `imported_id: costco:{barcode}` for dedup.
- **Category fallback:** Items with unknown department codes get no category (uncategorized in Actual). These can be manually categorized later.
- **The `api.updateTransaction` call** replaces the transaction's notes and adds subtransactions while preserving the original `imported_id`, `payee`, and `date` from the bank feed.
