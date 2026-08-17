/**
 * Multi-sheet .xlsx import.
 *
 * The organizer workbooks carry four sheets we care about — Transactions,
 * Assets, Debts, and Wealth_History — plus reference sheets we read only for
 * context (User_Profile). The CSV path in data.ts handles Transactions alone;
 * this module handles the whole workbook and folds Assets/Debts into the
 * WealthFacts shape the zakat calculators already consume.
 *
 * Every asset row is classified (halal / haram / mixed / tentative) via
 * classifyAsset() before it is allowed to affect zakatable wealth, so nothing
 * enters the base without a stated rule.
 */
import * as XLSX from 'xlsx';
import * as M from './engine';
import { classifyAsset, DEFAULT_NISAB } from './engine';
import type {
  Money,
  AssetDestination,
  MetalHolding,
  GoldSilverCategory,
  NisabConfig,
} from './engine';
import { normalizeRow, emptyWealthFacts } from './types';
import type {
  Transaction,
  RawTransactionRow,
  Classification,
  WealthFacts,
  DebtItem,
  DebtDueBucket,
  DebtCategory,
  ReceivableItem,
  ReceivableType,
  RepaymentLikelihood,
} from './types';

// ------------------------------- cell helpers -------------------------------

/** Excel serial date epoch: day 1 is 1900-01-01, with the well-known 1900 leap-year bug. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Sheets store dates as either real Date objects (when cellDates is on) or as
 * numeric serials. Both need to land as plain ISO `YYYY-MM-DD` strings, which
 * is what the transaction pipeline and Hijri conversion expect.
 */
function toISO(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(EXCEL_EPOCH_UTC + value * 86_400_000).toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return iso ? iso[1] : s;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return toISO(value);
  return String(value).trim();
}

/** Sheet money columns are plain numbers in CAD dollars, not cents. */
function money(value: unknown): Money {
  if (value === null || value === undefined || value === '') return M.ZERO;
  if (typeof value === 'number') return Number.isFinite(value) ? M.fromDollars(value) : M.ZERO;
  return M.parseMoney(String(value)) ?? M.ZERO;
}

function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(String(value ?? '').replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function yes(value: unknown): boolean {
  return text(value).toLowerCase() === 'yes';
}

type Row = Record<string, unknown>;

/** Reads a sheet into row objects keyed by its header row, or [] when absent. */
function readSheet(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true });
}

/** Sheet names vary in case/spacing between files; match forgivingly. */
function findSheet(wb: XLSX.WorkBook, ...candidates: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
  for (const want of candidates) {
    const hit = wb.SheetNames.find((n) => norm(n) === norm(want));
    if (hit) return hit;
  }
  return null;
}

// ------------------------------- result shapes -------------------------------

/** An Assets-sheet row after classification, kept for display in the UI. */
export interface ImportedAsset {
  id: string;
  keyword: string;
  description: string;
  amount: Money;
  quantity: number;
  unit: string;
  intendedUse: string;
  screeningStatus: string;
  repaymentLikelihood: string;
  missingInformation: string | null;
  classification: Classification;
  destination: AssetDestination;
  ruleCited: string;
  explanation: string;
}

/** A Debts-sheet row, before it is split into due-bucket line items. */
export interface ImportedDebt {
  id: string;
  keyword: string;
  creditor: string;
  outstanding: Money;
  dueWithin12Months: Money;
  overdue: Money;
  interestBearing: boolean;
  repaymentRequested: boolean;
  description: string;
}

/** One Wealth_History month-end snapshot. */
export interface WealthSnapshot {
  monthEnd: string;
  totalWealth: Money;
  netOfAllDebts: Money;
  netOf12MonthDebts: Money;
  eventNote: string;
}

export interface WorkbookImportResult {
  personName: string;
  transactions: Transaction[];
  assets: ImportedAsset[];
  debts: ImportedDebt[];
  history: WealthSnapshot[];
  /** Assets + debts folded into the shape the four zakat calculators consume. */
  wealthFacts: WealthFacts;
  /** Nisab from the workbook's User_Profile sheet, when it states one. */
  nisab: NisabConfig | null;
  sheetsFound: string[];
  warnings: string[];
}

// ------------------------------ asset mapping ------------------------------

const METAL_CATEGORY: Record<string, { metal: 'gold' | 'silver'; category: GoldSilverCategory }> = {
  worn_gold_jewelry: { metal: 'gold', category: 'customary_personal_jewelry' },
  investment_gold_coins: { metal: 'gold', category: 'bars_bullion_coins' },
  silver_bars: { metal: 'silver', category: 'bars_bullion_coins' },
};

const RECEIVABLE_TYPE: Record<string, ReceivableType> = {
  business_receivable_likely: 'business_sale_or_invoice',
  receivable_tentative: 'business_sale_or_invoice',
  personal_loan_receivable: 'personal_loan_to_others',
  personal_loan_receivable_doubtful: 'personal_loan_to_others',
};

const DEBT_CATEGORY: Record<string, DebtCategory> = {
  credit_card_balance: 'credit_card',
  business_supplier_invoice: 'business',
  student_loan: 'student_loan',
  mortgage: 'mortgage',
  personal_loan: 'personal_loan',
  overdue_business_debt: 'business',
};

function parseAssets(rows: Row[]): ImportedAsset[] {
  const out: ImportedAsset[] = [];
  for (const r of rows) {
    const id = text(r.asset_id);
    const keyword = text(r.keyword);
    if (!id && !keyword) continue;

    const verdict = classifyAsset(keyword);
    out.push({
      id: id || keyword,
      keyword,
      description: text(r.description),
      amount: money(r.amount_cad),
      quantity: num(r.quantity),
      unit: text(r.unit),
      intendedUse: text(r.intended_use),
      screeningStatus: text(r.screening_status),
      repaymentLikelihood: text(r.repayment_likelihood),
      missingInformation: text(r.missing_information) || null,
      classification: verdict.classification,
      destination: verdict.destination,
      ruleCited: verdict.rule,
      explanation: verdict.explanation,
    });
  }
  return out;
}

function parseDebts(rows: Row[]): ImportedDebt[] {
  const out: ImportedDebt[] = [];
  for (const r of rows) {
    const id = text(r.debt_id);
    const keyword = text(r.keyword);
    if (!id && !keyword) continue;
    out.push({
      id: id || keyword,
      keyword,
      creditor: text(r.creditor),
      outstanding: money(r.outstanding_balance_cad),
      dueWithin12Months: money(r.amount_due_within_12_months_cad),
      overdue: money(r.overdue_amount_cad),
      interestBearing: yes(r.interest_bearing),
      repaymentRequested: yes(r.repayment_requested),
      description: text(r.description),
    });
  }
  return out;
}

/**
 * Each sheet debt states BOTH a full outstanding balance and the portion due
 * within twelve months. A DebtItem carries a single amount in a single bucket,
 * so one sheet row becomes up to three items: the overdue slice, the rest of
 * the twelve-month slice, and the long-term remainder. Summing the first two
 * reproduces the twelve-month figure that Hanafi and Maliki deduct, while
 * summing all three reproduces the full balance the Hanbali rule set deducts —
 * both totals stay exact without changing the calculators.
 */
function toDebtItems(debts: readonly ImportedDebt[]): DebtItem[] {
  const items: DebtItem[] = [];
  for (const d of debts) {
    const category = DEBT_CATEGORY[d.keyword] ?? 'other';
    const overdue = d.overdue;
    const shortTermRest = M.clampAtZero(M.subtract(d.dueWithin12Months, overdue));
    const longTerm = M.clampAtZero(M.subtract(d.outstanding, d.dueWithin12Months));

    const push = (suffix: string, amount: Money, dueBucket: DebtDueBucket, label: string) => {
      if (M.isZero(amount)) return;
      items.push({ id: `${d.id}${suffix}`, label, amount, dueBucket, category });
    };

    push('-overdue', overdue, 'due_now_or_overdue', `${d.creditor || d.keyword} (overdue)`);
    push('-12mo', shortTermRest, 'due_within_12_months', `${d.creditor || d.keyword} (due within 12 months)`);
    push('-long', longTerm, 'full_long_term_balance', `${d.creditor || d.keyword} (long-term balance)`);
  }
  return items;
}

/**
 * Folds classified assets into WealthFacts. Only rows whose verdict permits it
 * reach the zakat base: `haram` and `tentative` assets are recorded and shown
 * but contribute nothing, and `mixed` retained cash is included in full per the
 * mixed-income rule.
 */
function toWealthFacts(assets: readonly ImportedAsset[], debts: readonly ImportedDebt[]): WealthFacts {
  const facts = emptyWealthFacts();
  const metals: MetalHolding[] = [];
  const receivables: ReceivableItem[] = [];

  for (const a of assets) {
    // A haram or unresolved asset never reaches the zakat base, whatever its
    // destination would otherwise have been.
    if (a.classification === 'haram') continue;

    const excludedButRecorded = a.classification === 'tentative' && a.destination !== 'receivable';
    if (excludedButRecorded) continue;

    switch (a.destination) {
      case 'cash':
        facts.cash = M.add(facts.cash, a.amount);
        break;
      case 'business_inventory':
        facts.businessInventory = M.add(facts.businessInventory, a.amount);
        break;
      case 'halal_investments':
        facts.halalInvestmentsExclStocks = M.add(facts.halalInvestmentsExclStocks, a.amount);
        break;
      case 'stock_shares':
        facts.screenedStockShareValue = M.add(facts.screenedStockShareValue, a.amount);
        break;
      case 'metal': {
        const spec = METAL_CATEGORY[a.keyword];
        if (!spec) break;
        metals.push({
          id: a.id,
          label: a.description || a.keyword.replace(/_/g, ' '),
          metal: spec.metal,
          grams: a.unit === 'grams' ? a.quantity : 0,
          purity: 24,
          category: spec.category,
          // The sheet's stated CAD value is authoritative; see MetalHolding.
          valueOverrideCad: a.amount,
        });
        break;
      }
      case 'receivable': {
        const type = RECEIVABLE_TYPE[a.keyword] ?? 'other';
        const likelihood: RepaymentLikelihood =
          a.repaymentLikelihood.toLowerCase() === 'doubtful' || a.classification === 'tentative'
            ? 'doubtful'
            : 'likely';
        receivables.push({
          id: a.id,
          label: a.description || a.keyword.replace(/_/g, ' '),
          amount: a.amount,
          type,
          expectedRepayment: likelihood,
          // Sheet receivables are outstanding by definition; a received loan
          // would have shown up in the ledger as cash instead.
          receivedThisYear: type === 'personal_loan_to_others' ? false : undefined,
        });
        break;
      }
      case 'excluded':
        break;
    }
  }

  facts.metals = metals;
  facts.receivables = receivables;
  facts.debts = toDebtItems(debts);
  return facts;
}

// --------------------------- wealth history & profile ---------------------------

const HISTORY_ASSET_COLUMNS = [
  'cash_and_bank_cad',
  'business_cash_cad',
  'business_inventory_halal_cad',
  'gold_silver_savings_cad',
  'customary_gold_jewelry_cad',
  'stock_shares_cad',
  'other_halal_investments_cad',
  'crypto_cad',
  'business_receivables_likely_cad',
  'personal_loans_receivable_cad',
] as const;

/**
 * Month-end snapshots. Prohibited inventory and doubtful receivables are left
 * out of the totals deliberately — they are not lawful zakatable wealth — which
 * keeps these figures consistent with how the Assets sheet is classified.
 */
function parseHistory(rows: Row[]): WealthSnapshot[] {
  const out: WealthSnapshot[] = [];
  for (const r of rows) {
    const monthEnd = toISO(r.month_end);
    if (!monthEnd) continue;
    const total = M.sum(HISTORY_ASSET_COLUMNS.map((c) => money(r[c])));
    out.push({
      monthEnd,
      totalWealth: total,
      netOfAllDebts: M.clampAtZero(M.subtract(total, money(r.total_outstanding_debts_cad))),
      netOf12MonthDebts: M.clampAtZero(M.subtract(total, money(r.debts_due_within_12_months_cad))),
      eventNote: text(r.event_note),
    });
  }
  return out.sort((a, b) => a.monthEnd.localeCompare(b.monthEnd));
}

/**
 * The workbook states a nisab threshold in CAD, but NisabConfig holds per-gram
 * metal prices. Back-solve the price so nisabThreshold() returns exactly the
 * stated figure rather than one derived from our own default metal prices.
 */
function parseNisab(rows: Row[]): NisabConfig | null {
  const field = (name: string): string => {
    const hit = rows.find((r) => text(r.field).toLowerCase() === name);
    return hit ? text(hit.value) : '';
  };
  const goldCad = M.parseMoney(field('gold_nisab_cad'));
  const silverCad = M.parseMoney(field('silver_nisab_cad'));
  const basisRaw = field('selected_nisab_basis').toLowerCase();
  if (!goldCad && !silverCad) return null;

  return {
    goldPerGramCad: goldCad
      ? M.fromCents(Math.round(M.toCents(goldCad) / GOLD_NISAB_GRAMS_LOCAL))
      : DEFAULT_NISAB.goldPerGramCad,
    silverPerGramCad: silverCad
      ? M.fromCents(Math.round(M.toCents(silverCad) / SILVER_NISAB_GRAMS_LOCAL))
      : DEFAULT_NISAB.silverPerGramCad,
    basis: basisRaw === 'gold' ? 'gold' : basisRaw === 'silver' ? 'silver' : DEFAULT_NISAB.basis,
  };
}

const GOLD_NISAB_GRAMS_LOCAL = 87.48;
const SILVER_NISAB_GRAMS_LOCAL = 612.36;

// --------------------------------- entry point ---------------------------------

export function parseWorkbook(data: ArrayBuffer): WorkbookImportResult {
  const wb = XLSX.read(data, { cellDates: true });
  const warnings: string[] = [];
  const sheetsFound: string[] = [];

  const pick = (...names: string[]): Row[] => {
    const found = findSheet(wb, ...names);
    if (!found) {
      warnings.push(`No "${names[0]}" sheet found in this workbook.`);
      return [];
    }
    sheetsFound.push(found);
    return readSheet(wb, found);
  };

  const txRows = pick('Transactions');
  const assetRows = pick('Assets');
  const debtRows = pick('Debts');
  const historyRows = pick('Wealth_History', 'WealthHistory', 'Wealth History');

  const profileSheet = findSheet(wb, 'User_Profile', 'UserProfile');
  const profileRows = profileSheet ? readSheet(wb, profileSheet) : [];

  const transactions: Transaction[] = [];
  for (const r of txRows) {
    const id = text(r.transaction_id);
    if (!id) continue;
    const raw: RawTransactionRow = {
      person_name: text(r.person_name),
      transaction_id: id,
      date: toISO(r.date),
      keyword: text(r.keyword),
      amount_cad: text(r.amount_cad),
      direction: text(r.direction),
      transaction_type: text(r.transaction_type),
      merchant_or_source: text(r.merchant_or_source),
      description: text(r.description),
      account: text(r.account),
      scope: text(r.scope),
      status: text(r.status),
      mixed_halal_pct: text(r.mixed_halal_pct),
      haram_portion_disposed: text(r.haram_portion_disposed),
      cost_basis_cad: text(r.cost_basis_cad),
      related_reference: text(r.related_reference),
      missing_information: text(r.missing_information),
    };
    transactions.push(normalizeRow(raw, 'csv'));
  }

  const assets = parseAssets(assetRows);
  const debts = parseDebts(debtRows);
  const history = parseHistory(historyRows);

  const unrecognised = assets.filter((a) => a.ruleCited === 'Unrecognised asset category');
  if (unrecognised.length) {
    warnings.push(
      `${unrecognised.length} asset row${unrecognised.length === 1 ? '' : 's'} used a category this rule set does not cover; held for scholar review rather than counted.`
    );
  }

  const personName =
    text(profileRows.find((r) => text(r.field).toLowerCase() === 'person_name')?.value) ||
    transactions[0]?.personName ||
    '';

  return {
    personName,
    transactions,
    assets,
    debts,
    history,
    wealthFacts: toWealthFacts(assets, debts),
    nisab: parseNisab(profileRows),
    sheetsFound,
    warnings,
  };
}
