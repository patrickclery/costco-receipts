import { randomUUID } from 'crypto';
import type { ReceiptListResponse, ReceiptDetailResponse, ReceiptSummary, ReceiptDetail } from './types.js';
import { costcoApi, interRequestDelay, CostcoAuthError, CostcoPermanentError } from './http.js';

const GRAPHQL_URL = 'https://ecom-api.costco.com/ebusiness/order/v1/orders/graphql';

const LIST_QUERY = `query receiptsWithCounts($startDate: String!, $endDate: String!, $documentType: String!, $documentSubType: String!) {
  receiptsWithCounts(startDate: $startDate, endDate: $endDate, documentType: $documentType, documentSubType: $documentSubType) {
    inWarehouse
    gasStation
    carWash
    gasAndCarWash
    receipts {
      warehouseName
      receiptType
      documentType
      transactionDateTime
      transactionBarcode
      transactionType
      total
      totalItemCount
      itemArray {
        itemNumber
      }
      tenderArray {
        tenderTypeCode
        tenderDescription
        amountTender
      }
      couponArray {
        upcnumberCoupon
      }
    }
  }
}`;

const DETAIL_QUERY = `query receiptsWithCounts($barcode: String!, $documentType: String!) {
  receiptsWithCounts(barcode: $barcode, documentType: $documentType) {
    receipts {
      warehouseName
      receiptType
      documentType
      transactionDateTime
      transactionDate
      companyNumber
      warehouseNumber
      operatorNumber
      warehouseShortName
      registerNumber
      transactionNumber
      transactionType
      transactionBarcode
      total
      warehouseAddress1
      warehouseAddress2
      warehouseCity
      warehouseState
      warehouseCountry
      warehousePostalCode
      totalItemCount
      subTotal
      taxes
      invoiceNumber
      sequenceNumber
      itemArray {
        itemNumber
        itemDescription01
        frenchItemDescription1
        itemDescription02
        frenchItemDescription2
        itemIdentifier
        itemDepartmentNumber
        unit
        amount
        taxFlag
        merchantID
        entryMethod
        transDepartmentNumber
        fuelUnitQuantity
        fuelGradeCode
        itemUnitPriceAmount
        fuelUomCode
        fuelUomDescription
        fuelUomDescriptionFr
        fuelGradeDescription
        fuelGradeDescriptionFr
      }
      tenderArray {
        tenderTypeCode
        tenderSubTypeCode
        tenderDescription
        amountTender
        displayAccountNumber
        sequenceNumber
        approvalNumber
        responseCode
        tenderTypeName
        transactionID
        merchantID
        entryMethod
        tenderAcctTxnNumber
        tenderAuthorizationCode
        tenderTypeNameFr
        tenderEntryMethodDescription
        walletType
        walletId
        storedValueBucket
      }
      subTaxes {
        tax1
        tax2
        tax3
        tax4
        aTaxPercent
        aTaxLegend
        aTaxAmount
        aTaxPrintCode
        aTaxPrintCodeFR
        aTaxIdentifierCode
        bTaxPercent
        bTaxLegend
        bTaxAmount
        bTaxPrintCode
        bTaxPrintCodeFR
        bTaxIdentifierCode
        cTaxPercent
        cTaxLegend
        cTaxAmount
        cTaxIdentifierCode
        dTaxPercent
        dTaxLegend
        dTaxAmount
        dTaxPrintCode
        dTaxPrintCodeFR
        dTaxIdentifierCode
        uTaxLegend
        uTaxAmount
        uTaxableAmount
      }
      instantSavings
      membershipNumber
    }
  }
}`;

function buildHeaders(): Record<string, string> {
  const token = process.env.COSTCO_AUTH_TOKEN!;
  const clientId = process.env.COSTCO_CLIENT_ID!;

  return {
    'Content-Type': 'application/json-patch+json',
    'costco.service': 'restOrders',
    'costco.env': 'ecom',
    'costco-x-authorization': token,
    'costco-x-wcs-clientId': clientId,
    'client-identifier': randomUUID(),
    'Origin': 'https://www.costco.ca',
    'Referer': 'https://www.costco.ca/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:149.0) Gecko/20100101 Firefox/149.0',
    'Accept': '*/*',
    'Accept-Language': 'en-CA,en-US;q=0.9,en;q=0.8',
  };
}

async function graphqlRequest<T>(query: string, variables: Record<string, string>): Promise<T> {
  const response = await costcoApi.post(GRAPHQL_URL, {
    json: { query, variables },
    headers: buildHeaders(),
  });
  return response.json<T>();
}

function formatDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate().toString().padStart(2, '0')}/${d.getFullYear()}`;
}

export async function fetchReceiptList(startDate: Date, endDate: Date): Promise<ReceiptSummary[]> {
  const variables = {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    documentType: 'all',
    documentSubType: 'all',
  };

  console.log(`  Fetching receipts ${variables.startDate} – ${variables.endDate}...`);
  const data = await graphqlRequest<ReceiptListResponse>(LIST_QUERY, variables);
  const receipts = data.data.receiptsWithCounts.receipts ?? [];
  const counts = data.data.receiptsWithCounts;
  console.log(`  Found ${receipts.length} receipts (warehouse: ${counts.inWarehouse}, gas: ${counts.gasStation})`);
  return receipts;
}

export async function fetchReceiptDetail(barcode: string): Promise<ReceiptDetail> {
  const variables = {
    barcode,
    documentType: 'warehouse',
  };

  const data = await graphqlRequest<ReceiptDetailResponse>(DETAIL_QUERY, variables);
  return data.data.receiptsWithCounts.receipts[0];
}

export async function fetchAllReceipts(): Promise<{ summaries: ReceiptSummary[]; details: ReceiptDetail[] }> {
  const allSummaries: ReceiptSummary[] = [];
  const now = new Date();
  let endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of current month

  console.log('Fetching receipt lists...');

  while (true) {
    const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - 2, 1); // 3 months back
    const receipts = await fetchReceiptList(startDate, endDate);

    if (receipts.length === 0) {
      console.log('  No more receipts found, stopping.');
      break;
    }

    allSummaries.push(...receipts);
    endDate = new Date(startDate.getFullYear(), startDate.getMonth(), 0); // last day of month before startDate
    await interRequestDelay();
  }

  console.log(`\nTotal receipts found: ${allSummaries.length}`);

  // Filter to warehouse receipts only for detail fetch
  const warehouseReceipts = allSummaries.filter(r => r.documentType === 'WarehouseReceiptDetail');
  console.log(`Warehouse receipts to fetch details for: ${warehouseReceipts.length}\n`);

  const allDetails: ReceiptDetail[] = [];
  for (const receipt of warehouseReceipts) {
    const date = receipt.transactionDateTime.split('T')[0];
    console.log(`  Fetching detail: ${date} ${receipt.warehouseName} ($${receipt.total})...`);
    try {
      const detail = await fetchReceiptDetail(receipt.transactionBarcode);
      allDetails.push(detail);
    } catch (err) {
      // D-10: 401 means token expired -- halt the entire fetch immediately
      if (err instanceof CostcoAuthError) {
        throw err; // Propagate up to index.ts for clean exit
      }
      // D-09: 400/403/404 are permanent -- skip this receipt, continue to next
      if (err instanceof CostcoPermanentError) {
        console.error(`  Skipping ${receipt.transactionBarcode}: HTTP ${err.status} (permanent error)`);
      } else {
        // D-07: Transient failures exhausted all retries -- skip and continue
        console.error(`  ERROR fetching ${receipt.transactionBarcode}: ${err}`);
      }
    }
    await interRequestDelay();
  }

  console.log(`\nFetched ${allDetails.length} receipt details.`);
  return { summaries: allSummaries, details: allDetails };
}
