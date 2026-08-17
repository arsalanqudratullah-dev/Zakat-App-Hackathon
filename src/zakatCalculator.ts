/**
 * Zakat calculation for all four Sunni madhahib (Hanafi, Maliki, Shafi'i,
 * Hanbali). Each school's formula is a fully separate function below —
 * consolidated from the former src/engine/zakat/{shared,hanafi,hanbali,
 * maliki,shafii,index}.ts, kept isolated per the architecture note in the
 * README even though they now live in one file.
 */
import * as M from './engine';
import { valueOfAll, valueOfCategories, evaluateHawlFromAssertions, nisabThreshold, ZAKAT_RATE } from './engine';
import type { Money, HawlRule, HawlEvaluation } from './engine';
import type { Madhhab, ZakatInput, ZakatResult, BreakdownLine, DebtItem, ReceivableItem, DebtDueBucket } from './types';

// ==================== shared helpers (formerly shared.ts) ====================
export function totalOf(breakdown: readonly BreakdownLine[]): Money {
  return M.sum(breakdown.filter((l) => !l.informational).map((l) => l.amount));
}

export function resolveHawl(input: ZakatInput, rule: HawlRule, threshold: Money): HawlEvaluation {
  const ledger = input.ledgerHawl;

  if (ledger && !ledger.indeterminate) return ledger;

  const asserted = evaluateHawlFromAssertions(rule, input.wealth.hawl, input.wealth.cash, threshold);
  if (!ledger) return asserted;

  return {
    ...asserted,
    anchorDate: ledger.anchorDate,
    anchorHijri: ledger.anchorHijri,
    dueDate: ledger.dueDate,
    dueHijri: ledger.dueHijri,
    closingBalance: ledger.closingBalance,
    daysRemaining: ledger.daysRemaining,
    indeterminate: true,
    explanation: asserted.satisfied
      ? `This ledger does not reach back a full lunar year, so it cannot establish the holding period on its own. You have stated that nisab was held for a complete year, so zakat is treated as payable now.`
      : `This ledger does not reach back a full lunar year, so it cannot establish the holding period on its own. ${asserted.explanation}`,
  };
}

export function thresholdFor(input: ZakatInput): Money {
  return nisabThreshold(input.nisab);
}

export function zakatOnWealth(zakatableWealth: Money): Money {
  return M.multiplyRate(zakatableWealth, ZAKAT_RATE);
}

export function computeDue(zakatableWealth: Money, meetsNisab: boolean, hawlSatisfied: boolean): Money {
  if (!meetsNisab || !hawlSatisfied) return M.ZERO;
  return zakatOnWealth(zakatableWealth);
}

export function sumDebts(debts: readonly DebtItem[], buckets: readonly DebtDueBucket[]): Money {
  return M.sum(debts.filter((d) => buckets.includes(d.dueBucket)).map((d) => d.amount));
}

export function sumAllDebts(debts: readonly DebtItem[]): Money {
  return M.sum(debts.map((d) => d.amount));
}

export function sumReceivables(
  receivables: readonly ReceivableItem[],
  predicate: (r: ReceivableItem) => boolean
): Money {
  return M.sum(receivables.filter(predicate).map((r) => r.amount));
}

// ============================ Hanafi (hanafi.ts) =============================
export const HANAFI_FORMULA =
  'Cash + halal investments + business inventory + all gold & silver + expected receivables − qualifying debts (due within 12 months)';

export function computeHanafi(input: ZakatInput): ZakatResult {
  const { wealth, nisab } = input;
  const notes: string[] = [];
  const threshold = thresholdFor(input);
  const hawl = resolveHawl(input, 'endpoints', threshold);

  const metals = valueOfAll(wealth.metals, nisab);

  const qualifyingDebts = sumDebts(wealth.debts, ['due_now_or_overdue', 'due_within_12_months']);
  const deferredDebts = wealth.debts.filter(
    (d) => d.dueBucket === 'due_after_12_months' || d.dueBucket === 'full_long_term_balance'
  );

  const expectedReceivables = sumReceivables(wealth.receivables, (r) => r.expectedRepayment === 'likely');
  const doubtful = wealth.receivables.filter((r) => r.expectedRepayment === 'doubtful');
  if (doubtful.length) {
    notes.push(
      `${doubtful.length} doubtful receivable${doubtful.length === 1 ? '' : 's'} totalling ${M.format(M.sum(doubtful.map((r) => r.amount)))} excluded, the Hanafi rule set allows deferring the calculation on doubtful debts until they are received.`
    );
  }

  const breakdown: BreakdownLine[] = [
    { label: 'Cash and bank balances', amount: wealth.cash },
    {
      label: 'Halal investments',
      amount: M.add(wealth.halalInvestmentsExclStocks, wealth.screenedStockShareValue),
      note: 'Stocks and shares are included; the exclusion of shares is specific to the Hanbali rule set.',
    },
    { label: 'Business inventory', amount: wealth.businessInventory },
    {
      label: 'All gold and silver',
      amount: metals,
      note: 'Bars, coins, and jewellery of every kind, worn, unused, or held as investment. Metal value only; gemstones are excluded by weighting for purity.',
    },
    { label: 'Expected receivables', amount: expectedReceivables },
    {
      label: 'Qualifying debts',
      amount: M.negate(qualifyingDebts),
      note: 'Only debts due now, overdue, or falling due within 12 months.',
    },
  ];

  if (deferredDebts.length) {
    const total = M.sum(deferredDebts.map((d) => d.amount));
    breakdown.push({
      label: 'Debts not deducted',
      amount: M.ZERO,
      informational: true,
      note: `${deferredDebts.length} item${deferredDebts.length === 1 ? '' : 's'} totalling ${M.format(total)}, not yet due, or the full balance of a long-term mortgage or student loan.`,
    });
  }

  const zakatableWealth = M.clampAtZero(totalOf(breakdown));
  const meetsNisab = M.gte(zakatableWealth, threshold);

  return {
    madhhab: 'hanafi',
    formula: HANAFI_FORMULA,
    breakdown,
    zakatableWealth,
    nisabThreshold: threshold,
    nisabBasis: nisab.basis,
    hawl,
    meetsNisab,
    zakatDue: computeDue(zakatableWealth, meetsNisab, hawl.satisfied),
    zakatOnWealth: zakatOnWealth(zakatableWealth),
    scholarReviewNotes: notes,
  };
}

// =========================== Hanbali (hanbali.ts) ============================
export const HANBALI_FORMULA =
  'Cash + zakatable investments (excluding stocks/shares) + business inventory + trade & savings gold/silver + non-customary jewellery − total outstanding creditor debts';

export function computeHanbali(input: ZakatInput): ZakatResult {
  const { wealth, nisab } = input;
  const notes: string[] = [];
  const threshold = thresholdFor(input);
  const hawl = resolveHawl(input, 'continuous', threshold);

  const metals = valueOfCategories(
    wealth.metals,
    ['bars_bullion_coins', 'business_trade_jewelry', 'excessive_non_customary_jewelry'],
    nisab
  );
  const excludedJewellery = valueOfCategories(wealth.metals, ['customary_personal_jewelry'], nisab);

  const borderline = wealth.metals.filter((h) => h.borderline);
  if (borderline.length) {
    notes.push(
      `${borderline.length} gold or silver item${borderline.length === 1 ? '' : 's'} marked borderline between customary and excessive jewellery, sent to Scholar Review rather than decided by the calculator.`
    );
  }

  const totalDebts = sumAllDebts(wealth.debts);
  const longTerm = wealth.debts.filter(
    (d) => d.dueBucket === 'full_long_term_balance' || d.dueBucket === 'due_after_12_months'
  );

  if (!M.isZero(wealth.screenedStockShareValue)) {
    notes.push(
      `${M.format(wealth.screenedStockShareValue)} of currently-held screened stocks and shares excluded entirely, under this Hanbali rule set shares are not trade inventory and are never zakatable, whether or not the hawl is complete. Only cash from a completed sale is assessed.`
    );
  }

  const lentOut = wealth.receivables.filter((r) => r.type === 'personal_loan_to_others' && !r.receivedThisYear);
  if (lentOut.length) {
    notes.push(
      `${lentOut.length} loan${lentOut.length === 1 ? '' : 's'} made to others, totalling ${M.format(M.sum(lentOut.map((r) => r.amount)))}, hard-excluded while unpaid, under this rule set these are not zakatable and are not even a tentative case.`
    );
  }
  const otherReceivables = wealth.receivables.filter((r) => r.type !== 'personal_loan_to_others');
  if (otherReceivables.length) {
    notes.push(
      `${otherReceivables.length} other receivable${otherReceivables.length === 1 ? '' : 's'} recorded but not included, this Hanbali formula has no receivables line item.`
    );
  }

  const breakdown: BreakdownLine[] = [
    { label: 'Cash and bank balances', amount: wealth.cash },
    {
      label: 'Zakatable investments',
      amount: wealth.halalInvestmentsExclStocks,
      note: 'Excludes stocks and shares entirely (see the shares rule).',
    },
    { label: 'Business inventory', amount: wealth.businessInventory },
    {
      label: 'Trade and savings gold and silver',
      amount: metals,
      note: M.isZero(excludedJewellery)
        ? 'Bullion, bars, coins, hoarded savings metal, trade jewellery, and non-customary jewellery.'
        : `Bullion, coins, trade jewellery, and non-customary jewellery. Excludes ${M.format(excludedJewellery)} of customary personal jewellery.`,
    },
    {
      label: 'Total outstanding creditor debts',
      amount: M.negate(totalDebts),
      note: longTerm.length
        ? `Full balances, with no 12-month limit, including ${M.format(M.sum(longTerm.map((d) => d.amount)))} of long-term debt that the other rule sets would not deduct.`
        : 'Full balances owed to creditors, with no 12-month limit.',
    },
  ];

  const zakatableWealth = M.clampAtZero(totalOf(breakdown));
  const meetsNisab = M.gte(zakatableWealth, threshold);

  return {
    madhhab: 'hanbali',
    formula: HANBALI_FORMULA,
    breakdown,
    zakatableWealth,
    nisabThreshold: threshold,
    nisabBasis: nisab.basis,
    hawl,
    meetsNisab,
    zakatDue: computeDue(zakatableWealth, meetsNisab, hawl.satisfied),
    zakatOnWealth: zakatOnWealth(zakatableWealth),
    scholarReviewNotes: notes,
  };
}

// ============================ Maliki (maliki.ts) =============================
export const MALIKI_FORMULA =
  'Cash + halal investments + business inventory + investment gold & silver + eligible business receivables − qualifying debts (excludes customary jewellery and unpaid personal loans)';

export function computeMaliki(input: ZakatInput): ZakatResult {
  const { wealth, nisab } = input;
  const notes: string[] = [];
  const threshold = thresholdFor(input);
  const hawl = resolveHawl(input, 'continuous', threshold);

  const metals = valueOfCategories(
    wealth.metals,
    ['bars_bullion_coins', 'investment_resale_jewelry', 'excessive_non_customary_jewelry'],
    nisab
  );
  const excludedJewellery = valueOfCategories(wealth.metals, ['customary_personal_jewelry'], nisab);

  const qualifyingDebts = sumDebts(wealth.debts, ['due_now_or_overdue', 'due_within_12_months']);

  const businessReceivables = sumReceivables(
    wealth.receivables,
    (r) => r.type === 'business_sale_or_invoice' && r.expectedRepayment === 'likely'
  );
  const receivedPersonalLoans = sumReceivables(
    wealth.receivables,
    (r) => r.type === 'personal_loan_to_others' && r.receivedThisYear === true
  );

  const unpaidPersonalLoans = wealth.receivables.filter(
    (r) => r.type === 'personal_loan_to_others' && !r.receivedThisYear
  );
  if (unpaidPersonalLoans.length) {
    notes.push(
      `${unpaidPersonalLoans.length} unpaid personal loan${unpaidPersonalLoans.length === 1 ? '' : 's'} to others totalling ${M.format(M.sum(unpaidPersonalLoans.map((r) => r.amount)))} excluded while outstanding, the Maliki rule set assesses one year of zakat on these only once received.`
    );
  }
  const doubtfulBusiness = wealth.receivables.filter(
    (r) => r.type === 'business_sale_or_invoice' && r.expectedRepayment === 'doubtful'
  );
  if (doubtfulBusiness.length) {
    notes.push(
      `${doubtfulBusiness.length} business receivable${doubtfulBusiness.length === 1 ? '' : 's'} with doubtful repayment excluded from this year's calculation.`
    );
  }

  const breakdown: BreakdownLine[] = [
    { label: 'Cash and bank balances', amount: wealth.cash },
    {
      label: 'Halal investments',
      amount: M.add(wealth.halalInvestmentsExclStocks, wealth.screenedStockShareValue),
    },
    { label: 'Business inventory', amount: wealth.businessInventory },
    {
      label: 'Investment gold and silver',
      amount: metals,
      note: M.isZero(excludedJewellery)
        ? 'Bullion, coins, and jewellery held as wealth or investment.'
        : `Bullion, coins, and investment jewellery. Excludes ${M.format(excludedJewellery)} of customary personal-use jewellery.`,
    },
    {
      label: 'Eligible receivables',
      amount: M.add(businessReceivables, receivedPersonalLoans),
      note: 'Business invoices expected to be paid, plus any personal loans actually received this year.',
    },
    {
      label: 'Qualifying debts',
      amount: M.negate(qualifyingDebts),
      note: 'Only debts currently due or expected within 12 months.',
    },
  ];

  const zakatableWealth = M.clampAtZero(totalOf(breakdown));
  const meetsNisab = M.gte(zakatableWealth, threshold);

  return {
    madhhab: 'maliki',
    formula: MALIKI_FORMULA,
    breakdown,
    zakatableWealth,
    nisabThreshold: threshold,
    nisabBasis: nisab.basis,
    hawl,
    meetsNisab,
    zakatDue: computeDue(zakatableWealth, meetsNisab, hawl.satisfied),
    zakatOnWealth: zakatOnWealth(zakatableWealth),
    scholarReviewNotes: notes,
  };
}

// ============================ Shafi'i (shafii.ts) ============================
export const SHAFII_FORMULA =
  'Cash + halal investments + business inventory + investment gold & silver + collectible receivables (no debt subtraction)';

export function computeShafii(input: ZakatInput): ZakatResult {
  const { wealth, nisab } = input;
  const notes: string[] = [];
  const threshold = thresholdFor(input);
  const hawl = resolveHawl(input, 'continuous', threshold);

  const metals = valueOfCategories(
    wealth.metals,
    ['bars_bullion_coins', 'investment_resale_jewelry', 'business_trade_jewelry'],
    nisab
  );
  const excludedJewellery = valueOfCategories(wealth.metals, ['customary_personal_jewelry'], nisab);

  const collectible = sumReceivables(wealth.receivables, (r) => r.expectedRepayment === 'likely');
  const doubtful = wealth.receivables.filter((r) => r.expectedRepayment === 'doubtful');
  if (doubtful.length) {
    notes.push(
      `${doubtful.length} receivable${doubtful.length === 1 ? '' : 's'} totalling ${M.format(M.sum(doubtful.map((r) => r.amount)))} flagged tentative for doubtful repayment and excluded this year. On receipt, true up any zakat that should have applied in prior years.`
    );
  }
  if (wealth.debts.length) {
    notes.push(
      `${wealth.debts.length} debt item${wealth.debts.length === 1 ? '' : 's'} totalling ${M.format(M.sum(wealth.debts.map((d) => d.amount)))} recorded but not subtracted; the Shafi'i rule set does not deduct personal debts from zakatable assets.`
    );
  }

  const breakdown: BreakdownLine[] = [
    { label: 'Cash and bank balances', amount: wealth.cash },
    {
      label: 'Halal investments',
      amount: M.add(wealth.halalInvestmentsExclStocks, wealth.screenedStockShareValue),
    },
    { label: 'Business inventory', amount: wealth.businessInventory },
    {
      label: 'Investment gold and silver',
      amount: metals,
      note: M.isZero(excludedJewellery)
        ? 'Bullion, coins, savings metal, investment jewellery, and business jewellery inventory.'
        : `Bullion, coins, savings metal, and investment or business jewellery. Excludes ${M.format(excludedJewellery)} of customary personal jewellery.`,
    },
    {
      label: 'Collectible receivables',
      amount: collectible,
      note: 'Included every year where repayment is likely, receipt is not required.',
    },
    {
      label: 'Personal debts',
      amount: M.ZERO,
      informational: true,
      note: 'Never subtracted under this rule set; the formula computes Gross, not Net, Zakatable Wealth.',
    },
  ];

  const zakatableWealth = M.clampAtZero(totalOf(breakdown));
  const meetsNisab = M.gte(zakatableWealth, threshold);

  return {
    madhhab: 'shafii',
    formula: SHAFII_FORMULA,
    breakdown,
    zakatableWealth,
    nisabThreshold: threshold,
    nisabBasis: nisab.basis,
    hawl,
    meetsNisab,
    zakatDue: computeDue(zakatableWealth, meetsNisab, hawl.satisfied),
    zakatOnWealth: zakatOnWealth(zakatableWealth),
    scholarReviewNotes: notes,
  };
}

// ==================== Dispatcher (formerly index.ts) =========================
export function computeZakat(madhhab: Madhhab, input: ZakatInput): ZakatResult {
  switch (madhhab) {
    case 'hanafi':
      return computeHanafi(input);
    case 'maliki':
      return computeMaliki(input);
    case 'shafii':
      return computeShafii(input);
    case 'hanbali':
      return computeHanbali(input);
  }
}

export const MADHHAB_FORMULAS: Record<Madhhab, string> = {
  hanafi: HANAFI_FORMULA,
  maliki: MALIKI_FORMULA,
  shafii: SHAFII_FORMULA,
  hanbali: HANBALI_FORMULA,
};
