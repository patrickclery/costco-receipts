import * as api from '@actual-app/api';
import type { ReceiptDetail } from './types.js';

export async function connectActual(): Promise<void> {
  await api.init({
    dataDir: '/tmp/actual-costco-cache',
    serverURL: process.env.ACTUAL_SERVER_URL!,
    password: process.env.ACTUAL_PASSWORD!,
  });

  await api.downloadBudget(process.env.ACTUAL_BUDGET_ID!);
  console.log('Connected to Actual Budget.');
}

export async function listAccounts(): Promise<void> {
  const accounts = await api.getAccounts();
  console.log('\nAvailable accounts:');
  for (const acct of accounts) {
    console.log(`  ${acct.id}  ${acct.name}${acct.closed ? ' (closed)' : ''}`);
  }
}

function toInteger(dollars: number): number {
  return Math.round(dollars * 100);
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

export async function importReceipts(receipts: ReceiptDetail[], accountId: string): Promise<void> {
  const transactions = receipts.map(receipt => {
    const date = receipt.transactionDate; // YYYY-MM-DD
    const isRefund = receipt.transactionType === 'Refund';
    const sign = isRefund ? 1 : -1;

    // Build subtransactions from line items
    const subtransactions = receipt.itemArray.map(item => {
      const desc = item.itemDescription01?.trim() || 'Unknown item';
      const notes = `${desc} (#${item.itemNumber})`;
      return {
        amount: toInteger(item.amount) * sign,
        notes,
      };
    });

    // Add tax as a subtransaction so splits sum to total
    if (receipt.taxes && receipt.taxes !== 0) {
      subtransactions.push({
        amount: toInteger(receipt.taxes) * sign,
        notes: 'Tax',
      });
    }

    return {
      date,
      amount: toInteger(receipt.total) * sign,
      payee_name: `Costco ${titleCase(receipt.warehouseName)}`,
      imported_id: `costco:${receipt.transactionBarcode}`,
      notes: `Costco ${titleCase(receipt.warehouseName)} — ${receipt.totalItemCount} items`,
      subtransactions,
    };
  });

  const result = await api.importTransactions(accountId, transactions.map(t => ({
    ...t,
    account: accountId,
  })));

  console.log(`\nImport complete: ${result.added.length} added, ${result.updated.length} updated`);
  if (result.added.length === 0 && transactions.length > 0) {
    console.log('(All transactions already existed — dedup working correctly)');
  }
}

export async function shutdownActual(): Promise<void> {
  await api.shutdown();
}
