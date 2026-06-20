// --- Costco API Types ---

export interface ReceiptSummary {
  warehouseName: string;
  receiptType: string;
  documentType: string;
  transactionDateTime: string;
  transactionBarcode: string;
  transactionType: string;
  total: number;
  totalItemCount: number;
  itemArray: { itemNumber: string }[];
  tenderArray: {
    tenderTypeCode: string;
    tenderDescription: string | null;
    amountTender: number;
  }[];
  couponArray: { upcnumberCoupon: string }[];
}

export interface ReceiptListResponse {
  data: {
    receiptsWithCounts: {
      inWarehouse: number;
      gasStation: number;
      carWash: number;
      gasAndCarWash: number;
      receipts: ReceiptSummary[];
    };
  };
}

export interface ItemDetail {
  itemNumber: string;
  itemDescription01: string;
  frenchItemDescription1: string;
  itemDescription02: string | null;
  frenchItemDescription2: string | null;
  itemIdentifier: string | null;
  itemDepartmentNumber: number;
  unit: number;
  amount: number;
  taxFlag: string | null;
  merchantID: string | null;
  entryMethod: string | null;
  transDepartmentNumber: number;
  fuelUnitQuantity: number | null;
  fuelGradeCode: string | null;
  itemUnitPriceAmount: number;
  fuelUomCode: string | null;
  fuelUomDescription: string | null;
  fuelUomDescriptionFr: string | null;
  fuelGradeDescription: string | null;
  fuelGradeDescriptionFr: string | null;
}

export interface TenderDetail {
  tenderTypeCode: string;
  tenderSubTypeCode: string | null;
  tenderDescription: string;
  amountTender: number;
  displayAccountNumber: string;
  sequenceNumber: string | null;
  approvalNumber: string | null;
  responseCode: string | null;
  tenderTypeName: string;
  transactionID: string | null;
  merchantID: string | null;
  entryMethod: string | null;
  tenderAcctTxnNumber: string | null;
  tenderAuthorizationCode: string | null;
  tenderTypeNameFr: string | null;
  tenderEntryMethodDescription: string | null;
  walletType: string | null;
  walletId: string | null;
  storedValueBucket: string | null;
}

export interface SubTaxes {
  tax1: number | null;
  tax2: number | null;
  tax3: number | null;
  tax4: number | null;
  aTaxPercent: number | null;
  aTaxLegend: string | null;
  aTaxAmount: number | null;
  aTaxPrintCode: string | null;
  aTaxPrintCodeFR: string | null;
  aTaxIdentifierCode: string | null;
  bTaxPercent: number | null;
  bTaxLegend: string | null;
  bTaxAmount: number | null;
  bTaxPrintCode: string | null;
  bTaxPrintCodeFR: string | null;
  bTaxIdentifierCode: string | null;
  cTaxPercent: number | null;
  cTaxLegend: string | null;
  cTaxAmount: number | null;
  cTaxIdentifierCode: string | null;
  dTaxPercent: number | null;
  dTaxLegend: string | null;
  dTaxAmount: number | null;
  dTaxPrintCode: string | null;
  dTaxPrintCodeFR: string | null;
  dTaxIdentifierCode: string | null;
  uTaxLegend: string | null;
  uTaxAmount: number | null;
  uTaxableAmount: number | null;
}

export interface ReceiptDetail {
  warehouseName: string;
  receiptType: string;
  documentType: string;
  transactionDateTime: string;
  transactionDate: string;
  companyNumber: number;
  warehouseNumber: number;
  operatorNumber: number;
  warehouseShortName: string;
  registerNumber: number;
  transactionNumber: number;
  transactionType: string;
  transactionBarcode: string;
  total: number;
  warehouseAddress1: string;
  warehouseAddress2: string | null;
  warehouseCity: string;
  warehouseState: string;
  warehouseCountry: string;
  warehousePostalCode: string;
  totalItemCount: number;
  subTotal: number;
  taxes: number;
  invoiceNumber: string | null;
  sequenceNumber: string | null;
  itemArray: ItemDetail[];
  tenderArray: TenderDetail[];
  subTaxes: SubTaxes;
  instantSavings: number;
  membershipNumber: string;
}

export interface ReceiptDetailResponse {
  data: {
    receiptsWithCounts: {
      receipts: ReceiptDetail[];
    };
  };
}
