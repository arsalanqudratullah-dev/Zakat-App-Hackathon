/**
 * CSV ingestion and scenario templates. Consolidated from the former
 * src/data/{csvParser,scenarioTemplates}.ts.
 */
import Papa from 'papaparse';
import * as M from './engine';
import { normalizeRow, emptyWealthFacts } from './types';
import type { RawTransactionRow, Transaction, WealthFacts } from './types';

// ============================= csvParser.ts =============================
const EXPECTED_HEADERS = [
  'person_name',
  'transaction_id',
  'date',
  'keyword',
  'amount_cad',
  'direction',
  'transaction_type',
  'merchant_or_source',
  'description',
  'account',
  'scope',
  'status',
];

export interface CsvParseResult {
  transactions: Transaction[];
  errors: string[];
  missingHeaders: string[];
}

export function parseTransactionsCsv(csvText: string): CsvParseResult {
  const result = Papa.parse<RawTransactionRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const errors: string[] = result.errors.map((e) => `Row ${e.row ?? '?'}: ${e.message}`);
  const fields = result.meta.fields ?? [];
  const missingHeaders = EXPECTED_HEADERS.filter((h) => !fields.includes(h));

  const transactions: Transaction[] = [];
  for (const row of result.data) {
    if (!row.transaction_id) continue;
    transactions.push(normalizeRow(row, 'csv'));
  }

  return { transactions, errors, missingHeaders };
}

// ========================= scenarioTemplates.ts ==========================
export interface ScenarioTemplate {
  id: string;
  name: string;
  summary: string;
  facts: WealthFacts;
}

export const scenarioTemplates: ScenarioTemplate[] = [
  {
    id: 'template-salaried',
    name: 'Salaried, with a mortgage',
    summary:
      'A near-term credit-card bill alongside a long-term mortgage, separates the rule sets that cap deductions at twelve months from the one that deducts the whole balance.',
    facts: {
      ...emptyWealthFacts(),
      cash: M.fromDollars(4200),
      halalInvestmentsExclStocks: M.fromDollars(1000),
      metals: [
        { id: 'm1', label: 'Gold bars and coins', metal: 'gold', grams: 11.16, purity: 24, category: 'bars_bullion_coins' },
        { id: 'm2', label: 'Wedding jewellery', metal: 'gold', grams: 8.93, purity: 22, category: 'customary_personal_jewelry' },
      ],
      debts: [
        { id: 'd1', label: 'Credit card balance', amount: M.fromDollars(300), dueBucket: 'due_now_or_overdue', category: 'credit_card' },
        { id: 'd2', label: 'Mortgage balance', amount: M.fromDollars(2000), dueBucket: 'full_long_term_balance', category: 'mortgage' },
      ],
    },
  },
  {
    id: 'template-business',
    name: 'Small business, money lent out',
    summary:
      'Trading stock, investment jewellery, an unpaid client invoice, and money lent to a friend, separates the rule sets on how receivables are treated.',
    facts: {
      ...emptyWealthFacts(),
      cash: M.fromDollars(2500),
      businessInventory: M.fromDollars(3000),
      metals: [
        { id: 'm1', label: 'Investment jewellery', metal: 'gold', grams: 13.95, purity: 24, category: 'investment_resale_jewelry' },
        { id: 'm2', label: 'Everyday jewellery', metal: 'gold', grams: 5.08, purity: 22, category: 'customary_personal_jewelry' },
      ],
      debts: [
        { id: 'd1', label: 'Personal loan instalment', amount: M.fromDollars(400), dueBucket: 'due_within_12_months', category: 'personal_loan' },
      ],
      receivables: [
        { id: 'r1', label: 'Unpaid client invoice', amount: M.fromDollars(900), type: 'business_sale_or_invoice', expectedRepayment: 'likely' },
        { id: 'r2', label: 'Lent to a friend', amount: M.fromDollars(600), type: 'personal_loan_to_others', expectedRepayment: 'likely', receivedThisYear: false },
      ],
    },
  },
  {
    id: 'template-shares',
    name: 'Shareholder, dipped mid-year',
    summary:
      'Screened shares still held, and wealth that fell below nisab partway through the year, separates the rule sets on shares and on what a mid-year dip does to the holding period.',
    facts: {
      ...emptyWealthFacts(),
      cash: M.fromDollars(5000),
      halalInvestmentsExclStocks: M.fromDollars(500),
      screenedStockShareValue: M.fromDollars(4000),
      metals: [
        { id: 'm1', label: 'Gold coins', metal: 'gold', grams: 2.79, purity: 24, category: 'bars_bullion_coins' },
      ],
      hawl: { atNisabAtStart: true, atNisabAtEnd: true, dippedMidYear: true },
    },
  },
];
