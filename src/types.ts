/**
 * Domain types: income classification, raw/normalized transactions, and
 * wealth facts + zakat result shapes. Consolidated from the former
 * src/types/{classification,transaction,wealth}.ts.
 */
import * as M from './engine';
import type { Money, MetalHolding, NisabConfig, GoldSilverCategory, HawlEvaluation, HawlRule } from './engine';

export type { MetalHolding, NisabConfig, GoldSilverCategory, HawlEvaluation, HawlRule };

// ========================== classification.ts ==========================
export type Classification = 'halal' | 'haram' | 'mixed' | 'tentative' | 'missing_information' | 'excluded';

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  halal: 'Halal',
  haram: 'Haram',
  mixed: 'Mixed',
  tentative: 'Scholar review',
  missing_information: 'Missing information',
  excluded: 'Not income',
};

export const CLASSIFICATION_ORDER: Classification[] = [
  'halal',
  'mixed',
  'tentative',
  'missing_information',
  'haram',
  'excluded',
];

export interface ClassifiedLine {
  transactionId: string;
  personName: string;
  date: string;
  keyword: string;
  description: string;
  merchantOrSource: string;
  amountCad: Money;
  direction: 'inflow' | 'outflow';
  transactionType: string;
  classification: Classification;
  halalAmount: Money;
  haramAmount: Money;
  ruleCited: string;
  explanation: string;
  netAdjustment?: string;
  linkedTo?: string[];
  importIssue?: string;
}

export interface ClassificationSummary {
  lines: ClassifiedLine[];
  totalHalal: Money;
  totalHaram: Money;
  mixedHalalPortion: Money;
  mixedHaramPortion: Money;
  counts: Record<Classification, number>;
  totalsByClassification: Record<Classification, Money>;
  tentativeCount: number;
  missingInfoCount: number;
  importIssueCount: number;
}

// =========================== transaction.ts =============================
export interface RawTransactionRow {
  person_name: string;
  transaction_id: string;
  date: string;
  keyword: string;
  amount_cad: string;
  direction: string;
  transaction_type: string;
  merchant_or_source: string;
  description: string;
  account: string;
  scope: string;
  status: string;
  mixed_halal_pct?: string;
  haram_portion_disposed?: string;
  cost_basis_cad?: string;
  related_reference?: string;
  missing_information?: string;
  parse_line?: string;
}

export interface Transaction {
  id: string;
  personName: string;
  date: string;
  keyword: string;
  amountCad: Money;
  direction: 'inflow' | 'outflow';
  transactionType: string;
  merchantOrSource: string;
  description: string;
  account: string;
  scope: 'personal' | 'business';
  status: string;
  mixedHalalPct: number | null;
  haramPortionDisposed: boolean | null;
  costBasisCad: Money | null;
  relatedReference: string[];
  missingInformation: string | null;
  source: 'manual' | 'csv';
  importIssue?: string;
}

function trim(v: string | undefined): string {
  return (v ?? '').trim();
}

export function normalizeRow(row: RawTransactionRow, source: 'manual' | 'csv' = 'csv'): Transaction {
  const amount = M.parseMoney(row.amount_cad);
  const pctRaw = trim(row.mixed_halal_pct);
  const pct = pctRaw === '' ? null : Number(pctRaw);
  const relatedRaw = trim(row.related_reference);

  return {
    id: trim(row.transaction_id),
    personName: trim(row.person_name),
    date: trim(row.date),
    keyword: trim(row.keyword),
    amountCad: amount ?? M.ZERO,
    direction: trim(row.direction).toLowerCase() === 'outflow' ? 'outflow' : 'inflow',
    transactionType: trim(row.transaction_type),
    merchantOrSource: trim(row.merchant_or_source),
    description: trim(row.description),
    account: trim(row.account),
    scope: trim(row.scope).toLowerCase() === 'business' ? 'business' : 'personal',
    status: trim(row.status) || 'posted',
    mixedHalalPct: pct !== null && Number.isFinite(pct) ? pct : null,
    haramPortionDisposed:
      trim(row.haram_portion_disposed) === '' ? null : trim(row.haram_portion_disposed).toLowerCase() === 'yes',
    costBasisCad: M.parseMoney(row.cost_basis_cad),
    relatedReference: relatedRaw ? relatedRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
    missingInformation: trim(row.missing_information) || null,
    source,
    importIssue: amount === null ? `Amount "${trim(row.amount_cad)}" could not be read as a number.` : undefined,
  };
}

// ============================== wealth.ts ================================

export type Madhhab = 'hanafi' | 'maliki' | 'shafii' | 'hanbali';

export const MADHHAB_ORDER: Madhhab[] = ['hanafi', 'maliki', 'shafii', 'hanbali'];

export const MADHHAB_LABELS: Record<Madhhab, string> = {
  hanafi: 'Hanafi',
  maliki: 'Maliki',
  shafii: "Shafi'i",
  hanbali: 'Hanbali',
};

export type DebtDueBucket =
  | 'due_now_or_overdue'
  | 'due_within_12_months'
  | 'due_after_12_months'
  | 'full_long_term_balance';

export type DebtCategory =
  | 'credit_card'
  | 'mortgage'
  | 'student_loan'
  | 'personal_loan'
  | 'bank_loan'
  | 'business'
  | 'bill_current'
  | 'other';

export const DEBT_BUCKET_LABELS: Record<DebtDueBucket, string> = {
  due_now_or_overdue: 'Due now or overdue',
  due_within_12_months: 'Due within 12 months',
  due_after_12_months: 'Due after 12 months',
  full_long_term_balance: 'Full long-term balance',
};

export const DEBT_CATEGORY_LABELS: Record<DebtCategory, string> = {
  credit_card: 'Credit card',
  mortgage: 'Mortgage',
  student_loan: 'Student loan',
  personal_loan: 'Personal loan',
  bank_loan: 'Bank loan',
  business: 'Business debt',
  bill_current: 'Current bill',
  other: 'Other',
};

export interface DebtItem {
  id: string;
  label: string;
  amount: Money;
  dueBucket: DebtDueBucket;
  category: DebtCategory;
}

export type ReceivableType = 'personal_loan_to_others' | 'business_sale_or_invoice' | 'other';
export type RepaymentLikelihood = 'likely' | 'doubtful';

export const RECEIVABLE_TYPE_LABELS: Record<ReceivableType, string> = {
  business_sale_or_invoice: 'Business sale or unpaid invoice',
  personal_loan_to_others: 'Money lent to someone else',
  other: 'Other amount owed to you',
};

export interface ReceivableItem {
  id: string;
  label: string;
  amount: Money;
  type: ReceivableType;
  expectedRepayment: RepaymentLikelihood;
  receivedThisYear?: boolean;
}

export interface HawlAssertions {
  atNisabAtStart: boolean;
  atNisabAtEnd: boolean;
  dippedMidYear: boolean;
}

export interface WealthFacts {
  cash: Money;
  halalInvestmentsExclStocks: Money;
  screenedStockShareValue: Money;
  businessInventory: Money;
  metals: MetalHolding[];
  debts: DebtItem[];
  receivables: ReceivableItem[];
  hawl: HawlAssertions;
}

export function emptyWealthFacts(): WealthFacts {
  return {
    cash: 0 as Money,
    halalInvestmentsExclStocks: 0 as Money,
    screenedStockShareValue: 0 as Money,
    businessInventory: 0 as Money,
    metals: [],
    debts: [],
    receivables: [],
    hawl: { atNisabAtStart: true, atNisabAtEnd: true, dippedMidYear: false },
  };
}

export interface BreakdownLine {
  label: string;
  amount: Money;
  note?: string;
  informational?: boolean;
}

export interface ZakatResult {
  madhhab: Madhhab;
  formula: string;
  breakdown: BreakdownLine[];
  zakatableWealth: Money;
  nisabThreshold: Money;
  nisabBasis: 'gold' | 'silver';
  hawl: HawlEvaluation;
  meetsNisab: boolean;
  zakatDue: Money;
  zakatOnWealth: Money;
  scholarReviewNotes: string[];
}

export interface ZakatInput {
  wealth: WealthFacts;
  nisab: NisabConfig;
  ledgerHawl?: HawlEvaluation | null;
}
