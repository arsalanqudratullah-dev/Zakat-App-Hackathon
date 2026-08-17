/**
 * Core calculation engine: money arithmetic, Hijri calendar conversion,
 * nisab thresholds, income classification, balance-sheet reconstruction,
 * and hawl (holding-period) evaluation.
 *
 * Consolidated from the former src/engine/{money,nisab,hijri,balanceSheet,
 * classification,hawl}.ts into one file. Each section below is a direct,
 * unmodified copy of the original module's body.
 */
import type { Transaction, ClassifiedLine, ClassificationSummary, Classification } from './types';
import { CLASSIFICATION_ORDER } from './types';

// ============================== money.ts ==============================
declare const MoneyBrand: unique symbol;
export type Money = number & { readonly [MoneyBrand]: 'cents' };

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

function assertSafe(cents: number): void {
  if (!Number.isFinite(cents)) throw new RangeError('Money: non-finite amount');
  if (Math.abs(cents) > MAX_SAFE_CENTS) throw new RangeError('Money: amount exceeds safe integer range');
}

function roundHalfUp(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

export const ZERO = 0 as Money;

export function fromCents(cents: number): Money {
  assertSafe(cents);
  if (!Number.isInteger(cents)) throw new TypeError('Money.fromCents: expected an integer');
  return cents as Money;
}

export function fromDollars(dollars: number): Money {
  if (!Number.isFinite(dollars)) throw new RangeError('Money.fromDollars: non-finite amount');
  const cents = roundHalfUp(Number((dollars * 100).toFixed(4)));
  assertSafe(cents);
  return cents as Money;
}

export function parseMoney(raw: string | number | null | undefined): Money | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? fromDollars(raw) : null;

  let s = raw.trim();
  if (s === '') return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$\s,]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;

  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  const cents = fromDollars(value);
  return (negative ? -cents : cents) as Money;
}

export function add(...values: Money[]): Money {
  let total = 0;
  for (const v of values) total += v;
  assertSafe(total);
  return total as Money;
}

export function subtract(a: Money, b: Money): Money {
  const r = a - b;
  assertSafe(r);
  return r as Money;
}

export function negate(a: Money): Money {
  return -a as Money;
}

export function sum(values: readonly Money[]): Money {
  let total = 0;
  for (const v of values) total += v;
  assertSafe(total);
  return total as Money;
}

export function multiplyRate(amount: Money, rate: number): Money {
  if (!Number.isFinite(rate)) throw new RangeError('Money.multiplyRate: non-finite rate');
  const cents = roundHalfUp(amount * rate);
  assertSafe(cents);
  return cents as Money;
}

export function percentOf(amount: Money, percent: number): Money {
  return multiplyRate(amount, percent / 100);
}

export function splitByPercent(amount: Money, halalPercent: number): { halal: Money; haram: Money } {
  const halal = percentOf(amount, halalPercent);
  return { halal, haram: subtract(amount, halal) };
}

export function clampAtZero(a: Money): Money {
  return (a < 0 ? 0 : a) as Money;
}

export function isZero(a: Money): boolean {
  return a === 0;
}

export function isNegative(a: Money): boolean {
  return a < 0;
}

export function gte(a: Money, b: Money): boolean {
  return a >= b;
}

export function toDollars(a: Money): number {
  return a / 100;
}

export function toCents(a: Money): number {
  return a;
}

const CAD = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const CAD_WHOLE = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function format(a: Money): string {
  return CAD.format(a / 100);
}

export function formatCompact(a: Money): string {
  const abs = Math.abs(a);
  const MILLION_IN_CENTS = 100_000_000;
  const TEN_K_IN_CENTS = 1_000_000;
  if (abs >= MILLION_IN_CENTS) return `$${(a / MILLION_IN_CENTS).toFixed(1)}M`;
  if (abs >= TEN_K_IN_CENTS) return `$${Math.round(a / 100_000)}k`;
  return CAD_WHOLE.format(a / 100);
}

export function formatSigned(a: Money): string {
  return a < 0 ? `− ${format(Math.abs(a) as Money)}` : format(a);
}

// Namespace alias so the sections below (originally `import * as M from
// './money'` in separate files) resolve unchanged, byte-for-byte, against
// the functions defined just above.
const M = {
  ZERO,
  fromCents,
  fromDollars,
  parseMoney,
  add,
  subtract,
  negate,
  sum,
  multiplyRate,
  percentOf,
  splitByPercent,
  clampAtZero,
  isZero,
  isNegative,
  gte,
  toDollars,
  toCents,
  format,
  formatCompact,
  formatSigned,
};

// ============================== nisab.ts ==============================
export const GOLD_NISAB_GRAMS = 87.48;
export const SILVER_NISAB_GRAMS = 612.36;

export const ZAKAT_RATE = 0.025;

export type NisabBasis = 'gold' | 'silver';

export interface MetalPrices {
  goldPerGramCad: Money;
  silverPerGramCad: Money;
}

export interface NisabConfig extends MetalPrices {
  basis: NisabBasis;
}

export const DEFAULT_NISAB: NisabConfig = {
  goldPerGramCad: M.fromDollars(107.5),
  silverPerGramCad: M.fromDollars(1.24),
  basis: 'silver',
};

export function goldNisabValue(prices: MetalPrices): Money {
  return M.multiplyRate(prices.goldPerGramCad, GOLD_NISAB_GRAMS);
}

export function silverNisabValue(prices: MetalPrices): Money {
  return M.multiplyRate(prices.silverPerGramCad, SILVER_NISAB_GRAMS);
}

export function nisabThreshold(config: NisabConfig): Money {
  return config.basis === 'gold' ? goldNisabValue(config) : silverNisabValue(config);
}

export type Metal = 'gold' | 'silver';

export interface MetalHolding {
  id: string;
  label: string;
  metal: Metal;
  grams: number;
  purity: number;
  category: GoldSilverCategory;
  borderline?: boolean;
  /**
   * Authoritative CAD value supplied by an imported workbook. When present it
   * wins over the grams x purity x spot-price calculation, because an imported
   * Assets sheet states the appraised value directly and re-deriving it from
   * our own metal prices would silently contradict the source file. Left unset
   * for manually entered holdings, which are valued from grams as before.
   */
  valueOverrideCad?: Money;
}

export type GoldSilverCategory =
  | 'bars_bullion_coins'
  | 'customary_personal_jewelry'
  | 'investment_resale_jewelry'
  | 'business_trade_jewelry'
  | 'excessive_non_customary_jewelry';

export const GOLD_SILVER_CATEGORY_LABELS: Record<GoldSilverCategory, string> = {
  bars_bullion_coins: 'Bars, bullion, or coins',
  customary_personal_jewelry: 'Customary personal-use jewellery',
  investment_resale_jewelry: 'Investment or resale jewellery',
  business_trade_jewelry: 'Business or trade jewellery inventory',
  excessive_non_customary_jewelry: 'Excessive / non-customary jewellery',
};

export function holdingValue(holding: MetalHolding, prices: MetalPrices): Money {
  if (holding.valueOverrideCad !== undefined) return holding.valueOverrideCad;
  const purityFraction = Math.min(Math.max(holding.purity, 0), 24) / 24;
  const pureGrams = holding.grams * purityFraction;
  const perGram = holding.metal === 'gold' ? prices.goldPerGramCad : prices.silverPerGramCad;
  return M.multiplyRate(perGram, pureGrams);
}

export function valueOfCategories(
  holdings: readonly MetalHolding[],
  categories: readonly GoldSilverCategory[],
  prices: MetalPrices
): Money {
  return M.sum(
    holdings.filter((h) => categories.includes(h.category)).map((h) => holdingValue(h, prices))
  );
}

export function valueOfAll(holdings: readonly MetalHolding[], prices: MetalPrices): Money {
  return M.sum(holdings.map((h) => holdingValue(h, prices)));
}

// ============================== hijri.ts ==============================
export interface HijriDate {
  year: number;
  month: number;
  day: number;
}

export const HIJRI_MONTHS = [
  'Muharram',
  'Safar',
  "Rabi' al-Awwal",
  "Rabi' al-Thani",
  'Jumada al-Ula',
  'Jumada al-Akhirah',
  'Rajab',
  "Sha'ban",
  'Ramadan',
  'Shawwal',
  "Dhu al-Qa'dah",
  'Dhu al-Hijjah',
] as const;

export const MS_PER_DAY = 86_400_000;
export const MEAN_HIJRI_YEAR_DAYS = 354.36707;

export function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY);
}

export function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const umalquraFormatter: Intl.DateTimeFormat | null = (() => {
  try {
    const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const probe = fmt.formatToParts(new Date(Date.UTC(2026, 7, 16)));
    const year = Number(probe.find((p) => p.type === 'year')?.value);
    return year > 1000 && year < 1700 ? fmt : null;
  } catch {
    return null;
  }
})();

export const usingUmmAlQura = umalquraFormatter !== null;

function toJDN(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY) + 2440588;
}

function tabularToHijri(date: Date): HijriDate {
  const jdn = toJDN(date);
  const daysSinceEpoch = jdn - 1948440 + 10632;
  const n = Math.floor((daysSinceEpoch - 1) / 10631);
  let rem = daysSinceEpoch - 10631 * n;
  const j = Math.floor((10985 - rem) / 5316) * Math.floor((50 * rem) / 17719) +
    Math.floor(rem / 5670) * Math.floor((43 * rem) / 15238);
  rem =
    rem -
    Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
    Math.floor(j / 16) * Math.floor((15238 * j) / 43) +
    29;
  const month = Math.floor((24 * rem) / 709);
  const day = rem - Math.floor((709 * month) / 24);
  const year = 30 * n + j - 30;
  return { year, month, day };
}

export function toHijri(date: Date): HijriDate {
  if (umalquraFormatter) {
    const parts = umalquraFormatter.formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const year = get('year');
    const month = get('month');
    const day = get('day');
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return { year, month, day };
    }
  }
  return tabularToHijri(date);
}

export function formatHijri(date: Date): string {
  const h = toHijri(date);
  return `${h.day} ${HIJRI_MONTHS[h.month - 1] ?? h.month} ${h.year} AH`;
}

export function compareHijri(a: HijriDate, b: HijriDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

export function addHijriYears(date: Date, years: number): Date {
  const start = startOfUTCDay(date);
  const from = toHijri(start);
  const target: HijriDate = { year: from.year + years, month: from.month, day: from.day };

  let cursor = startOfUTCDay(addDays(start, Math.round(years * MEAN_HIJRI_YEAR_DAYS)));

  for (let i = 0; i < 60; i++) {
    const cmp = compareHijri(toHijri(cursor), target);
    if (cmp === 0) return cursor;
    cursor = addDays(cursor, cmp < 0 ? 1 : -1);
  }

  let probe = startOfUTCDay(addDays(start, Math.round(years * MEAN_HIJRI_YEAR_DAYS)));
  for (let i = 0; i < 60; i++) {
    const h = toHijri(probe);
    if (h.year === target.year && h.month === target.month) {
      let last = probe;
      while (true) {
        const next = addDays(last, 1);
        const nh = toHijri(next);
        if (nh.year !== target.year || nh.month !== target.month) break;
        last = next;
      }
      return last;
    }
    const cmp = compareHijri({ ...h, day: 1 }, { ...target, day: 1 });
    probe = addDays(probe, cmp < 0 ? 1 : -1);
  }

  return startOfUTCDay(addDays(start, Math.round(years * MEAN_HIJRI_YEAR_DAYS)));
}

export function addHijriYear(date: Date): Date {
  return addHijriYears(date, 1);
}

export function hasCompletedHijriYear(start: Date, end: Date): boolean {
  return startOfUTCDay(end).getTime() >= addHijriYear(start).getTime();
}

// =========================== balanceSheet.ts ===========================
export interface BalancePoint {
  date: string;
  balance: Money;
  delta: Money;
  haramSeparated: Money;
}

export interface BalanceSeries {
  points: BalancePoint[];
  first: Date | null;
  last: Date | null;
  closingBalance: Money;
  peakBalance: Money;
  totalHaramSeparated: Money;
}

const REDUCES_WEALTH = new Set(['expense', 'refund', 'chargeback', 'loan_repayment', 'asset_purchase']);

export function buildBalanceSeries(
  lines: readonly ClassifiedLine[],
  openingBalance: Money = M.ZERO
): BalanceSeries {
  const dated = lines
    .map((l) => ({ line: l, date: parseISODate(l.date) }))
    .filter((x): x is { line: ClassifiedLine; date: Date } => x.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (dated.length === 0) {
    return {
      points: [],
      first: null,
      last: null,
      closingBalance: openingBalance,
      peakBalance: openingBalance,
      totalHaramSeparated: M.ZERO,
    };
  }

  const dailyDelta = new Map<string, Money>();
  const dailyHaram = new Map<string, Money>();

  for (const { line, date } of dated) {
    const key = toISODate(date);

    let delta = M.ZERO;
    if (line.classification === 'halal' || line.classification === 'mixed') {
      delta = line.halalAmount;
    }
    if (REDUCES_WEALTH.has(line.transactionType) && line.direction === 'outflow') {
      delta = M.subtract(delta, line.amountCad);
    }

    if (!M.isZero(delta)) {
      dailyDelta.set(key, M.add(dailyDelta.get(key) ?? M.ZERO, delta));
    }
    if (!M.isZero(line.haramAmount)) {
      dailyHaram.set(key, M.add(dailyHaram.get(key) ?? M.ZERO, line.haramAmount));
    }
  }

  const first = startOfUTCDay(dated[0].date);
  const last = startOfUTCDay(dated[dated.length - 1].date);

  const span = diffDays(last, first);
  const MAX_DAYS = 10_000;
  const step = span > MAX_DAYS ? Math.ceil(span / MAX_DAYS) : 1;

  const points: BalancePoint[] = [];
  let balance = openingBalance;
  let haramRunning = M.ZERO;
  let peak = openingBalance;

  for (let cursor = first; cursor.getTime() <= last.getTime(); cursor = addDays(cursor, step)) {
    let delta = M.ZERO;
    let haram = M.ZERO;
    for (let k = 0; k < step; k++) {
      const key = toISODate(addDays(cursor, k));
      delta = M.add(delta, dailyDelta.get(key) ?? M.ZERO);
      haram = M.add(haram, dailyHaram.get(key) ?? M.ZERO);
    }

    balance = M.add(balance, delta);
    haramRunning = M.add(haramRunning, haram);
    if (balance > peak) peak = balance;

    points.push({
      date: toISODate(cursor),
      balance,
      delta,
      haramSeparated: haramRunning,
    });
  }

  return {
    points,
    first,
    last,
    closingBalance: balance,
    peakBalance: peak,
    totalHaramSeparated: haramRunning,
  };
}

export function sampleForChart(series: BalanceSeries, maxPoints = 400): BalancePoint[] {
  const { points } = series;
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const out: BalancePoint[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  const lastPoint = points[points.length - 1];
  if (out[out.length - 1] !== lastPoint) out.push(lastPoint);
  return out;
}

// =========================== classification.ts =========================
const CLEARLY_HALAL = new Set([
  'salary_income',
  'freelance_income',
  'consulting_income',
  'tip_income',
  'rental_income',
  'business_sale_income',
  'scholarship_income',
  'content_revenue_income',
  'commission_income',
  'gift_income',
  'tax_refund',
  'insurance_proceeds',
  'employee_reimbursement',
  'stock_dividend_income',
  'stock_sale_proceeds',
  'crypto_sale_with_cost_basis',
]);

const CLEARLY_HARAM = new Set([
  'alcohol_sales_income',
  'pork_sales_income',
  'vape_sales_income',
  'gambling_income',
  'lottery_winnings',
  'prohibited_product_commission',
]);

const TENTATIVE_REASONS: Record<string, string> = {
  tentative_cashback:
    'Card cashback sits in a contested area of contemporary fiqh, treated by some as a permissible rebate on a purchase and by others as a benefit flowing from an interest-bearing credit contract. The outcome turns on the card agreement, which is not in this record.',
  tentative_unscreened_investment:
    'This distribution came from a fund that has not been Shariah-screened, so the permissibility of the underlying holdings is unknown. Screening the fund would resolve it.',
  crowdfunding_payment:
    'The nature of the consideration is ambiguous: a reward-based sale and an unconditional gift are treated differently, and the reward structure is not covered by this rule set.',
};

const NOT_INCOME: Record<string, string> = {
  internal_transfer: 'A transfer between the holder’s own accounts. The two legs cancel, so counting either would invent income.',
  loan_received: 'Borrowed money is a liability, not income. Record the outstanding balance under Debts instead.',
  loan_repayment: 'Repaying a loan settles a liability; it is neither income nor a deductible expense here.',
  gross_business_sale: 'Superseded by the matching processor settlement, which is the amount actually received. Counting both would double the sale.',
  processor_fee: 'Already deducted inside the processor settlement figure; subtracting it again would double-count the fee.',
  refundable_client_deposit: 'A refundable deposit remains the client’s money until the work is delivered, so it is a liability rather than earnings.',
  crypto_purchase: 'Converting cash into another asset. Wealth changes form, not amount.',
  equipment_purchase: 'Converting cash into a personal asset. Wealth changes form, not amount.',
  inventory_purchase: 'Converting cash into stock for resale, capture the stock under Business inventory.',
  security_deposit_return: 'The holder’s own money coming back, not new income.',
  business_overpayment_return: 'Correcting a customer overpayment. It reverses money that was never genuinely earned.',
};

const REFUND_KEYWORDS = new Set(['customer_refund', 'chargeback']);

const LEDGER_TYPES = new Set([
  'income',
  'expense',
  'adjustment',
  'asset_sale',
  'settlement',
  'refund',
  'chargeback',
  'transfer',
  'loan',
  'loan_repayment',
  'reimbursement',
  'deposit',
  'deposit_return',
  'asset_purchase',
]);

export function isLedgerRelevant(t: Transaction): boolean {
  return LEDGER_TYPES.has(t.transactionType);
}

interface BaseVerdict {
  classification: Classification;
  halalAmount: Money;
  haramAmount: Money;
  rule: string;
  explanation: string;
}

function classifyKeyword(t: Transaction): BaseVerdict {
  const kw = t.keyword;
  const pretty = kw.replace(/_/g, ' ');

  if (t.transactionType === 'expense' && !(kw in NOT_INCOME)) {
    return {
      classification: 'excluded',
      halalAmount: M.ZERO,
      haramAmount: M.ZERO,
      rule: 'Spending',
      explanation:
        'Money spent, not received. It carries no permissibility verdict of its own, but it does reduce the wealth your holding period is measured against.',
    };
  }

  if (kw === 'interest_income') {
    return {
      classification: 'haram',
      halalAmount: M.ZERO,
      haramAmount: t.amountCad,
      rule: 'Riba',
      explanation:
        'Interest credited by a bank is riba, which all four madhahib treat as impermissible. It is separated from zakatable wealth. Note that removing it is not itself an act of zakat (see the disposal guidance).',
    };
  }

  if (CLEARLY_HALAL.has(kw)) {
    return {
      classification: 'halal',
      halalAmount: t.amountCad,
      haramAmount: M.ZERO,
      rule: 'Permissible earnings',
      explanation: `Ordinary permissible income (${pretty}). The full amount enters zakatable wealth, subject to the active madhhab’s treatment of that asset class.`,
    };
  }

  if (CLEARLY_HARAM.has(kw)) {
    return {
      classification: 'haram',
      halalAmount: M.ZERO,
      haramAmount: t.amountCad,
      rule: 'Impermissible source',
      explanation: `This income derives from a prohibited source (${pretty}). It is separated from halal wealth and excluded from zakat entirely.`,
    };
  }

  if (kw === 'mixed_income_missing_split') {
    return {
      classification: 'missing_information',
      halalAmount: M.ZERO,
      haramAmount: M.ZERO,
      rule: 'Unsplit mixed income',
      explanation:
        'This payout combines permissible and prohibited sales, but no split was supplied. Without the proportion it cannot be treated as Mixed; an unsplit mixed amount is Missing Information until the breakdown is obtained.',
    };
  }

  if (kw === 'mixed_income_disposed') {
    const pct = t.mixedHalalPct ?? 0;
    const { halal, haram } = M.splitByPercent(t.amountCad, pct);
    return {
      classification: 'mixed',
      halalAmount: halal,
      haramAmount: haram,
      rule: 'Mixed, haram portion disposed',
      explanation: `${pct}% of this payout was permissible. The impermissible ${100 - pct}% (${M.format(haram)}) was identified and disposed of, so zakat applies only to the ${M.format(halal)} retained.`,
    };
  }

  if (kw === 'mixed_income_retained') {
    const pct = t.mixedHalalPct ?? 0;
    const { haram } = M.splitByPercent(t.amountCad, pct);
    return {
      classification: 'mixed',
      halalAmount: t.amountCad,
      haramAmount: haram,
      rule: 'Mixed, retained in full',
      explanation: `${pct}% of this payout was permissible, but the whole amount was kept rather than the impermissible portion being separated. The full ${M.format(t.amountCad)} therefore stays in zakatable wealth, being mixed is not itself an exemption. The ${M.format(haram)} impermissible share is still flagged for disposal.`,
    };
  }

  if (kw in TENTATIVE_REASONS) {
    return {
      classification: 'tentative',
      halalAmount: M.ZERO,
      haramAmount: M.ZERO,
      rule: 'Unresolved',
      explanation: TENTATIVE_REASONS[kw],
    };
  }

  if (kw.startsWith('missing_info_') || kw === 'crypto_sale_missing_cost_basis') {
    return {
      classification: 'missing_information',
      halalAmount: M.ZERO,
      haramAmount: M.ZERO,
      rule: 'Incomplete record',
      explanation: t.missingInformation
        ? `Cannot be classified, ${t.missingInformation.charAt(0).toLowerCase()}${t.missingInformation.slice(1)}.`
        : 'Cannot be classified, required details are absent from this record.',
    };
  }

  if (kw in NOT_INCOME) {
    return {
      classification: 'excluded',
      halalAmount: M.ZERO,
      haramAmount: M.ZERO,
      rule: 'Not income',
      explanation: NOT_INCOME[kw],
    };
  }

  if (kw === 'processor_payout') {
    return {
      classification: 'halal',
      halalAmount: t.amountCad,
      haramAmount: M.ZERO,
      rule: 'Net settlement',
      explanation:
        'Net settlement from the payment processor for permissible sales, after fees. This is the amount actually received; the matching gross sale legs are excluded so the revenue is counted once.',
    };
  }

  if (REFUND_KEYWORDS.has(kw)) {
    return {
      classification: 'excluded',
      halalAmount: M.ZERO,
      haramAmount: M.ZERO,
      rule: 'Reversal',
      explanation: 'Money returned to a customer. It reduces the income of the sale it reverses rather than standing as its own line.',
    };
  }

  return {
    classification: 'tentative',
    halalAmount: M.ZERO,
    haramAmount: M.ZERO,
    rule: 'Unrecognised category',
    explanation: `"${pretty}" is not a category this rule set covers. It is held for scholar review rather than assumed permissible.`,
  };
}

export function classifyTransactions(transactions: readonly Transaction[]): ClassificationSummary {
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const relevant = transactions.filter(isLedgerRelevant);

  const reductions = new Map<string, Money>();
  for (const t of relevant) {
    if (!REFUND_KEYWORDS.has(t.keyword)) continue;
    for (const ref of t.relatedReference) {
      reductions.set(ref, M.add(reductions.get(ref) ?? M.ZERO, t.amountCad));
    }
  }

  const lines: ClassifiedLine[] = [];

  for (const t of relevant) {
    const base = classifyKeyword(t);
    let halalAmount = base.halalAmount;
    let classification = base.classification;
    let explanation = base.explanation;
    let netAdjustment: string | undefined;

    if (classification === 'halal' && t.relatedReference.length) {
      for (const ref of t.relatedReference) {
        const other = byId.get(ref);
        if (
          other &&
          other.amountCad === t.amountCad &&
          other.description === t.description &&
          other.direction === 'inflow'
        ) {
          halalAmount = M.ZERO;
          classification = 'excluded';
          netAdjustment = `Duplicate of ${ref}`;
          explanation = `This matches ${ref} exactly, same amount, same description, and linked by reference, so it is the same payment recorded twice. It is excluded to avoid counting the income twice.`;
        }
      }
    }

    const reduction = reductions.get(t.id);
    if (reduction && !M.isZero(reduction) && !M.isZero(halalAmount)) {
      const before = halalAmount;
      halalAmount = M.clampAtZero(M.subtract(halalAmount, reduction));
      netAdjustment = `Reduced by ${M.format(reduction)} of refunds`;
      explanation += ` A linked refund or chargeback of ${M.format(reduction)} reduced this line from ${M.format(before)} to ${M.format(halalAmount)}.`;
    }

    if (REFUND_KEYWORDS.has(t.keyword) && t.relatedReference.length) {
      netAdjustment = `Applied against ${t.relatedReference.join(', ')}`;
    }

    lines.push({
      transactionId: t.id,
      personName: t.personName,
      date: t.date,
      keyword: t.keyword,
      description: t.description,
      merchantOrSource: t.merchantOrSource,
      amountCad: t.amountCad,
      direction: t.direction,
      transactionType: t.transactionType,
      classification,
      halalAmount,
      haramAmount: base.haramAmount,
      ruleCited: base.rule,
      explanation,
      netAdjustment,
      linkedTo: t.relatedReference.length ? t.relatedReference : undefined,
      importIssue: t.importIssue,
    });
  }

  const counts = Object.fromEntries(CLASSIFICATION_ORDER.map((c) => [c, 0])) as Record<Classification, number>;
  const totalsByClassification = Object.fromEntries(
    CLASSIFICATION_ORDER.map((c) => [c, M.ZERO])
  ) as Record<Classification, Money>;

  for (const l of lines) {
    counts[l.classification] += 1;
    const contribution =
      l.classification === 'haram'
        ? l.haramAmount
        : l.classification === 'halal' || l.classification === 'mixed'
          ? l.halalAmount
          : l.amountCad;
    totalsByClassification[l.classification] = M.add(totalsByClassification[l.classification], contribution);
  }

  const mixed = lines.filter((l) => l.classification === 'mixed');

  return {
    lines,
    totalHalal: M.sum(
      lines.filter((l) => l.classification === 'halal' || l.classification === 'mixed').map((l) => l.halalAmount)
    ),
    totalHaram: M.sum(lines.map((l) => l.haramAmount)),
    mixedHalalPortion: M.sum(mixed.map((l) => l.halalAmount)),
    mixedHaramPortion: M.sum(mixed.map((l) => l.haramAmount)),
    counts,
    totalsByClassification,
    tentativeCount: counts.tentative,
    missingInfoCount: counts.missing_information,
    importIssueCount: lines.filter((l) => l.importIssue).length,
  };
}

// ============================== hawl.ts ================================
export type HawlRule = 'endpoints' | 'continuous';

export interface HawlDip {
  date: string;
  balance: Money;
}

export interface HawlEvaluation {
  rule: HawlRule;
  satisfied: boolean;
  anchorDate: string | null;
  anchorHijri: string | null;
  dueDate: string | null;
  dueHijri: string | null;
  anchorBalance: Money | null;
  closingBalance: Money;
  dips: HawlDip[];
  daysRemaining: number;
  explanation: string;
  indeterminate: boolean;
}

function emptyEvaluation(rule: HawlRule, closing: Money): HawlEvaluation {
  return {
    rule,
    satisfied: false,
    anchorDate: null,
    anchorHijri: null,
    dueDate: null,
    dueHijri: null,
    anchorBalance: null,
    closingBalance: closing,
    dips: [],
    daysRemaining: 0,
    explanation:
      'No dated transactions available, so the holding period cannot be established from the ledger. Import transactions covering at least one lunar year to determine the hawl.',
    indeterminate: true,
  };
}

export function evaluateHawl(
  series: BalanceSeries,
  nisabThreshold: Money,
  rule: HawlRule,
  assetFloor: Money = M.ZERO
): HawlEvaluation {
  const { points } = series;
  if (points.length === 0) return emptyEvaluation(rule, series.closingBalance);

  const totalAt = (m: Money) => M.add(m, assetFloor);
  const atOrAbove = (m: Money) => M.gte(totalAt(m), nisabThreshold);
  const lastPoint = points[points.length - 1];
  const closing = lastPoint.balance;

  let anchorIdx = -1;
  if (rule === 'continuous') {
    for (let i = points.length - 1; i >= 0; i--) {
      if (!atOrAbove(points[i].balance)) break;
      anchorIdx = i;
    }
  } else {
    anchorIdx = points.findIndex((p) => atOrAbove(p.balance));
  }

  if (anchorIdx === -1) {
    return {
      rule,
      satisfied: false,
      anchorDate: null,
      anchorHijri: null,
      dueDate: null,
      dueHijri: null,
      anchorBalance: null,
      closingBalance: closing,
      dips: [],
      daysRemaining: 0,
      explanation: `Wealth never reached the nisab threshold of ${M.format(nisabThreshold)} at any point in this ledger, so no zakat year is visible in it.`,
      indeterminate: true,
    };
  }

  const anchorPoint = points[anchorIdx];
  const anchorDate = parseISODate(anchorPoint.date)!;
  const dueDate = addHijriYear(anchorDate);
  const lastDate = parseISODate(lastPoint.date)!;

  const yearComplete = lastDate.getTime() >= dueDate.getTime();
  const daysRemaining = yearComplete
    ? 0
    : Math.ceil((dueDate.getTime() - lastDate.getTime()) / 86_400_000);

  const windowEnd = yearComplete ? dueDate : lastDate;
  const dips: HawlDip[] = [];
  for (let i = anchorIdx; i < points.length; i++) {
    const d = parseISODate(points[i].date);
    if (!d || d.getTime() > windowEnd.getTime()) break;
    if (!atOrAbove(points[i].balance)) dips.push({ date: points[i].date, balance: points[i].balance });
  }

  const priorDips =
    rule === 'continuous'
      ? points.slice(0, anchorIdx).filter((p) => !atOrAbove(p.balance))
      : [];
  const wasReset = priorDips.length > 0;
  const lastResetDate = wasReset ? priorDips[priorDips.length - 1].date : null;

  let dueBalance: Money = closing;
  for (const p of points) {
    const t = parseISODate(p.date);
    if (!t) continue;
    if (t.getTime() <= dueDate.getTime()) dueBalance = p.balance;
    else break;
  }

  const observedReset = rule === 'continuous' && (wasReset || dips.length > 0);
  const tooShortToTell = !yearComplete && !observedReset;

  let satisfied: boolean;
  let explanation: string;

  if (tooShortToTell) {
    const spanDays = Math.max(0, Math.round((lastDate.getTime() - anchorDate.getTime()) / 86_400_000));
    return {
      rule,
      satisfied: false,
      anchorDate: toISODate(anchorDate),
      anchorHijri: formatHijri(anchorDate),
      dueDate: toISODate(dueDate),
      dueHijri: formatHijri(dueDate),
      anchorBalance: anchorPoint.balance,
      closingBalance: closing,
      dips,
      daysRemaining,
      explanation:
        (spanDays === 0
          ? `This ledger records a single day at or above the nisab threshold of ${M.format(nisabThreshold)}, `
          : `This ledger covers ${spanDays} day${spanDays === 1 ? '' : 's'} at or above the nisab threshold of ${M.format(nisabThreshold)}, which is short of a full lunar year, `) +
        `and it does not show what was held beforehand, so the holding period cannot be settled from it alone. ` +
        `If nisab has been held continuously for a lunar year, confirm it and the zakat becomes payable now; on this ledger alone the year would close on ${toISODate(dueDate)} (${formatHijri(dueDate)}).`,
      indeterminate: true,
    };
  }

  if (rule === 'endpoints') {
    satisfied = yearComplete && atOrAbove(anchorPoint.balance) && atOrAbove(dueBalance);
    if (!yearComplete) {
      explanation = `The zakat year began on ${toISODate(anchorDate)} (${formatHijri(anchorDate)}), when wealth first reached the nisab threshold of ${M.format(nisabThreshold)}. It completes on ${toISODate(dueDate)} (${formatHijri(dueDate)}), ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining, so zakat is not yet due.`;
    } else if (satisfied) {
      explanation =
        `Wealth was at or above the nisab threshold of ${M.format(nisabThreshold)} on both the first day of the lunar year (${toISODate(anchorDate)}) and its last (${toISODate(dueDate)}), so the hawl is complete.` +
        (dips.length
          ? ` Wealth fell below nisab on ${dips.length} day${dips.length === 1 ? '' : 's'} in between; under this rule set a mid-year dip does not reset the year.`
          : '');
    } else {
      explanation = `The lunar year that began on ${toISODate(anchorDate)} completed on ${toISODate(dueDate)}, but wealth was below the nisab threshold of ${M.format(nisabThreshold)} at ${atOrAbove(anchorPoint.balance) ? 'the end' : 'the start'} of it, so the holding period is not satisfied.`;
    }
  } else {
    satisfied = yearComplete && dips.length === 0;
    const remaining = `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining, so zakat is not yet due`;

    if (wasReset && !yearComplete) {
      explanation = `Wealth fell below the nisab threshold of ${M.format(nisabThreshold)} on ${lastResetDate}, which resets the zakat year under this rule set. A new year began on ${toISODate(anchorDate)} (${formatHijri(anchorDate)}) when nisab was reached again, and completes on ${toISODate(dueDate)} (${formatHijri(dueDate)}), ${remaining}.`;
    } else if (wasReset) {
      explanation = `Wealth fell below the nisab threshold of ${M.format(nisabThreshold)} on ${lastResetDate}, resetting the zakat year. The replacement year ran unbroken from ${toISODate(anchorDate)} to ${toISODate(dueDate)} (${formatHijri(dueDate)}), so the hawl is now complete.`;
    } else if (!yearComplete) {
      explanation = `The zakat year began on ${toISODate(anchorDate)} (${formatHijri(anchorDate)}), when wealth reached the nisab threshold of ${M.format(nisabThreshold)}, and has stayed at or above it since. It completes on ${toISODate(dueDate)} (${formatHijri(dueDate)}), ${remaining}.`;
    } else {
      explanation = `Wealth remained continuously at or above the nisab threshold of ${M.format(nisabThreshold)} for the full lunar year from ${toISODate(anchorDate)} to ${toISODate(dueDate)} (${formatHijri(dueDate)}), with no dip, so the hawl is complete.`;
    }
  }

  return {
    rule,
    satisfied,
    anchorDate: toISODate(anchorDate),
    anchorHijri: formatHijri(anchorDate),
    dueDate: toISODate(dueDate),
    dueHijri: formatHijri(dueDate),
    anchorBalance: anchorPoint.balance,
    closingBalance: closing,
    dips,
    daysRemaining,
    explanation,
    indeterminate: false,
  };
}

export function evaluateHawlFromAssertions(
  rule: HawlRule,
  assertions: { atNisabAtStart: boolean; atNisabAtEnd: boolean; dippedMidYear: boolean },
  closingBalance: Money,
  nisabThreshold: Money
): HawlEvaluation {
  const { atNisabAtStart, atNisabAtEnd, dippedMidYear } = assertions;
  const satisfied =
    rule === 'endpoints' ? atNisabAtStart && atNisabAtEnd : atNisabAtStart && atNisabAtEnd && !dippedMidYear;

  let explanation: string;
  if (rule === 'endpoints') {
    explanation = satisfied
      ? `Wealth was at or above the nisab threshold of ${M.format(nisabThreshold)} at both the start and the end of the lunar year.${dippedMidYear ? ' A mid-year dip was recorded but does not reset the year under this rule set.' : ''}`
      : `The holding period is not satisfied: this rule set requires wealth at or above ${M.format(nisabThreshold)} at both the start and the end of the lunar year.`;
  } else {
    explanation = satisfied
      ? `Wealth remained continuously at or above the nisab threshold of ${M.format(nisabThreshold)} for the full lunar year, with no dip.`
      : dippedMidYear
        ? `Wealth dipped below the nisab threshold of ${M.format(nisabThreshold)} during the year, which resets the zakat year under this rule set. A new year begins once nisab is reached again.`
        : `The holding period is not satisfied: this rule set requires an unbroken lunar year at or above ${M.format(nisabThreshold)}.`;
  }

  return {
    rule,
    satisfied,
    anchorDate: null,
    anchorHijri: null,
    dueDate: null,
    dueHijri: null,
    anchorBalance: null,
    closingBalance,
    dips: dippedMidYear ? [{ date: 'asserted', balance: M.ZERO }] : [],
    daysRemaining: 0,
    explanation,
    indeterminate: false,
  };
}

// ======================= asset & debt classification =======================
// Imported workbooks carry Assets and Debts sheets alongside Transactions.
// Every asset row gets the same kind of verdict a ledger line does, so nothing
// lands in zakatable wealth without a stated reason.

export type AssetDestination =
  | 'cash'
  | 'business_inventory'
  | 'halal_investments'
  | 'stock_shares'
  | 'metal'
  | 'receivable'
  | 'excluded';

export interface AssetVerdict {
  classification: Classification;
  destination: AssetDestination;
  rule: string;
  explanation: string;
}

/**
 * One entry per asset keyword the organizer workbooks use. Anything absent
 * falls through to `tentative` rather than being assumed permissible, matching
 * how the transaction classifier treats unrecognised categories.
 */
const ASSET_RULES: Record<string, AssetVerdict> = {
  cash: {
    classification: 'halal',
    destination: 'cash',
    rule: 'Cash holding',
    explanation: 'Cash on hand. Included in zakatable wealth under every school.',
  },
  personal_chequing: {
    classification: 'halal',
    destination: 'cash',
    rule: 'Bank balance',
    explanation: 'A personal chequing balance is cash held at a bank and is fully zakatable.',
  },
  savings_balance: {
    classification: 'halal',
    destination: 'cash',
    rule: 'Bank balance',
    explanation: 'A personal savings balance is cash and is fully zakatable.',
  },
  business_chequing: {
    classification: 'halal',
    destination: 'cash',
    rule: 'Bank balance',
    explanation: 'Business operating cash is treated the same as personal cash for zakat purposes.',
  },
  business_inventory_halal: {
    classification: 'halal',
    destination: 'business_inventory',
    rule: 'Trade goods',
    explanation:
      'Permissible stock held for resale. Trade inventory is zakatable at its resale value under all four schools.',
  },
  business_inventory_prohibited: {
    classification: 'haram',
    destination: 'excluded',
    rule: 'Prohibited inventory',
    explanation:
      'Inventory of prohibited products. It is not lawful wealth, so it is excluded from the zakat base entirely rather than assessed. Disposal is a separate obligation from zakat.',
  },
  worn_gold_jewelry: {
    classification: 'halal',
    destination: 'metal',
    rule: 'Customary jewellery',
    explanation:
      'Gold jewellery in regular personal use. The Hanafi rule set assesses it; Maliki, Shafi\u2019i, and Hanbali exempt customary personal jewellery.',
  },
  investment_gold_coins: {
    classification: 'halal',
    destination: 'metal',
    rule: 'Investment metal',
    explanation: 'Gold held as savings or investment. Assessable under all four schools.',
  },
  silver_bars: {
    classification: 'halal',
    destination: 'metal',
    rule: 'Investment metal',
    explanation: 'Silver held as savings or investment. Assessable under all four schools.',
  },
  stock_shares_screened: {
    classification: 'halal',
    destination: 'stock_shares',
    rule: 'Screened shares',
    explanation:
      'Shares that passed screening. Hanafi, Maliki, and Shafi\u2019i include them as halal investments; the Hanbali rule set excludes the shares themselves and assesses only cash realised on sale.',
  },
  other_halal_investment: {
    classification: 'halal',
    destination: 'halal_investments',
    rule: 'Screened investment',
    explanation: 'A non-stock investment that passed screening, included as a zakatable investment.',
  },
  halal_crypto_portfolio: {
    classification: 'halal',
    destination: 'halal_investments',
    rule: 'Screened investment',
    explanation:
      'A crypto portfolio already screened as permissible, included wherever the selected school includes zakatable investments.',
  },
  tentative_crypto_portfolio_unscreened: {
    classification: 'tentative',
    destination: 'excluded',
    rule: 'Unresolved',
    explanation:
      'This crypto portfolio has not been screened, so whether the underlying holdings are permissible is unknown. Held for scholar review rather than counted, and not treated as permissible by default.',
  },
  business_receivable_likely: {
    classification: 'halal',
    destination: 'receivable',
    rule: 'Business receivable',
    explanation: 'An outstanding invoice expected to be paid, from permissible trade.',
  },
  receivable_tentative: {
    classification: 'tentative',
    destination: 'receivable',
    rule: 'Doubtful recovery',
    explanation:
      'A business receivable whose repayment is doubtful. Carried as doubtful so each school\u2019s own rule on uncertain debts applies rather than being counted outright.',
  },
  personal_loan_receivable: {
    classification: 'halal',
    destination: 'receivable',
    rule: 'Money lent out',
    explanation:
      'Money lent to another person and still unpaid. The schools differ sharply here, so it is carried separately from business receivables.',
  },
  personal_loan_receivable_doubtful: {
    classification: 'tentative',
    destination: 'receivable',
    rule: 'Money lent out, doubtful',
    explanation:
      'A doubtful personal loan receivable. Under the Hanbali rule set lent-out money is excluded outright while unpaid rather than held as an unresolved case.',
  },
  mixed_business_cash_retained: {
    classification: 'mixed',
    destination: 'cash',
    rule: 'Mixed, retained in full',
    explanation:
      'A mixed-income cash balance whose impermissible portion was identified but not separated. Because the whole amount was retained, it stays in zakatable wealth; being mixed is not itself an exemption. The impermissible share is still owed disposal.',
  },
  haram_income_separated: {
    classification: 'haram',
    destination: 'excluded',
    rule: 'Impermissible source',
    explanation:
      'Income from a prohibited source that has already been separated from lawful wealth. It is excluded from the zakat base. Removing it is an obligation in its own right, not an act of zakat.',
  },
};

export function classifyAsset(keyword: string): AssetVerdict {
  const known = ASSET_RULES[keyword];
  if (known) return known;
  return {
    classification: 'tentative',
    destination: 'excluded',
    rule: 'Unrecognised asset category',
    explanation: `"${keyword.replace(/_/g, ' ')}" is not a category this rule set covers. It is held for scholar review rather than assumed permissible.`,
  };
}
