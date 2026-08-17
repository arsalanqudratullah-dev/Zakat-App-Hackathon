import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Transaction, Madhhab, WealthFacts, NisabConfig, ClassificationSummary, ZakatResult } from './types';
import { emptyWealthFacts } from './types';
import * as M from './engine';
import { DEFAULT_NISAB, nisabThreshold, valueOfAll, classifyTransactions, buildBalanceSeries, evaluateHawl } from './engine';
import type { Money, BalanceSeries, HawlEvaluation, HawlRule } from './engine';
import { computeZakat } from './zakatCalculator';
import type { ImportedAsset, WorkbookImportResult } from './xlsxImport';

const STORAGE_KEY = 'hzc.state.v2';
const THEME_KEY = 'hzc.theme';

export interface Scenario {
  id: string;
  name: string;
  summary: string;
  facts: WealthFacts;
  createdAt: number;
  updatedAt: number;
}

const HAWL_RULE: Record<Madhhab, HawlRule> = {
  hanafi: 'endpoints',
  maliki: 'continuous',
  shafii: 'continuous',
  hanbali: 'continuous',
};

interface Persisted {
  transactions: Transaction[];
  madhhab: Madhhab;
  wealthFacts: WealthFacts;
  nisab: NisabConfig;
  openingBalance: Money;
  acknowledged: string[];
  scenarios: Scenario[];
  activeScenarioId: string | null;
  useLedgerForCash: boolean;
  importedAssets: ImportedAsset[];
}

function load(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
  } catch {
    return {};
  }
}

interface AppState {
  transactions: Transaction[];
  addTransactions: (t: Transaction[]) => number;
  clearTransactions: () => void;

  madhhab: Madhhab;
  setMadhhab: (m: Madhhab) => void;

  wealthFacts: WealthFacts;
  setWealthFacts: (w: WealthFacts) => void;

  nisab: NisabConfig;
  setNisab: (n: NisabConfig) => void;
  threshold: Money;

  openingBalance: Money;
  setOpeningBalance: (m: Money) => void;

  useLedgerForCash: boolean;
  setUseLedgerForCash: (v: boolean) => void;

  acknowledged: Set<string>;
  toggleAcknowledged: (id: string) => void;

  /** Assets sheet rows from an imported workbook, each already classified. */
  importedAssets: ImportedAsset[];
  applyWorkbook: (result: WorkbookImportResult) => number;

  scenarios: Scenario[];
  activeScenarioId: string | null;
  saveScenario: (name: string, summary: string) => void;
  loadScenario: (id: string) => void;
  deleteScenario: (id: string) => void;
  duplicateScenario: (id: string) => void;
  renameScenario: (id: string, name: string, summary: string) => void;

  classification: ClassificationSummary;
  balanceSeries: BalanceSeries;
  zakat: ZakatResult;

  blockingIds: string[];
  hasLedger: boolean;

  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const saved = useMemo(load, []);

  const [transactions, setTransactions] = useState<Transaction[]>(saved.transactions ?? []);
  const [madhhab, setMadhhab] = useState<Madhhab>(saved.madhhab ?? 'hanafi');
  const [wealthFacts, setWealthFacts] = useState<WealthFacts>(saved.wealthFacts ?? emptyWealthFacts());
  const [nisab, setNisab] = useState<NisabConfig>(saved.nisab ?? DEFAULT_NISAB);
  const [openingBalance, setOpeningBalance] = useState<Money>(saved.openingBalance ?? M.ZERO);
  const [useLedgerForCash, setUseLedgerForCash] = useState<boolean>(saved.useLedgerForCash ?? true);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set(saved.acknowledged ?? []));
  const [scenarios, setScenarios] = useState<Scenario[]>(saved.scenarios ?? []);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(saved.activeScenarioId ?? null);
  const [importedAssets, setImportedAssets] = useState<ImportedAsset[]>(saved.importedAssets ?? []);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
    if (stored === 'light' || stored === 'dark') return stored;
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const payload: Persisted = {
      transactions,
      madhhab,
      wealthFacts,
      nisab,
      openingBalance,
      acknowledged: [...acknowledged],
      scenarios,
      activeScenarioId,
      useLedgerForCash,
      importedAssets,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }, [transactions, madhhab, wealthFacts, nisab, openingBalance, acknowledged, scenarios, activeScenarioId, useLedgerForCash, importedAssets]);

  const addTransactions = useCallback((incoming: Transaction[]) => {
    let added = 0;
    setTransactions((prev) => {
      const seen = new Set(prev.map((t) => t.id));
      const fresh = incoming.filter((t) => t.id && !seen.has(t.id));
      added = fresh.length;
      return fresh.length ? [...prev, ...fresh] : prev;
    });
    return added;
  }, []);

  const clearTransactions = useCallback(() => setTransactions([]), []);

  /**
   * Applies a parsed multi-sheet workbook. Transactions merge into the ledger
   * as usual; the Assets and Debts sheets replace the current holdings wholesale
   * rather than merging, because a workbook is a point-in-time statement of what
   * is held and merging two of them would double-count balances. Ledger-derived
   * cash is switched off so the Assets sheet's own cash figure is used.
   */
  const applyWorkbook = useCallback((result: WorkbookImportResult) => {
    const added = addTransactions(result.transactions);
    if (result.assets.length || result.debts.length) {
      setWealthFacts(result.wealthFacts);
      setImportedAssets(result.assets);
      setUseLedgerForCash(false);
    }
    if (result.nisab) setNisab(result.nisab);
    return added;
  }, [addTransactions]);

  const toggleAcknowledged = useCallback((id: string) => {
    setAcknowledged((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const classification = useMemo(() => classifyTransactions(transactions), [transactions]);

  const balanceSeries = useMemo(
    () => buildBalanceSeries(classification.lines, openingBalance),
    [classification.lines, openingBalance]
  );

  const threshold = useMemo(() => nisabThreshold(nisab), [nisab]);
  const hasLedger = balanceSeries.points.length > 0;

  const nonCashWealth = useMemo(
    () =>
      M.sum([
        wealthFacts.halalInvestmentsExclStocks,
        wealthFacts.screenedStockShareValue,
        wealthFacts.businessInventory,
        valueOfAll(wealthFacts.metals, nisab),
      ]),
    [
      wealthFacts.halalInvestmentsExclStocks,
      wealthFacts.screenedStockShareValue,
      wealthFacts.businessInventory,
      wealthFacts.metals,
      nisab,
    ]
  );

  const ledgerHawl = useMemo<HawlEvaluation | null>(
    () => (hasLedger ? evaluateHawl(balanceSeries, threshold, HAWL_RULE[madhhab], nonCashWealth) : null),
    [hasLedger, balanceSeries, threshold, madhhab, nonCashWealth]
  );

  const effectiveWealth = useMemo<WealthFacts>(() => {
    if (!useLedgerForCash || !hasLedger) return wealthFacts;
    return { ...wealthFacts, cash: balanceSeries.closingBalance };
  }, [wealthFacts, useLedgerForCash, hasLedger, balanceSeries.closingBalance]);

  const zakat = useMemo(
    () => computeZakat(madhhab, { wealth: effectiveWealth, nisab, ledgerHawl }),
    [madhhab, effectiveWealth, nisab, ledgerHawl]
  );

  const blockingIds = useMemo(
    () =>
      classification.lines
        .filter((l) => l.classification === 'missing_information' && !acknowledged.has(l.transactionId))
        .map((l) => l.transactionId),
    [classification.lines, acknowledged]
  );

  const saveScenario = useCallback(
    (name: string, summary: string) => {
      const now = Date.now();
      const scenario: Scenario = {
        id: `s-${now}-${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || 'Untitled scenario',
        summary: summary.trim(),
        facts: structuredClone(wealthFacts),
        createdAt: now,
        updatedAt: now,
      };
      setScenarios((prev) => [scenario, ...prev]);
      setActiveScenarioId(scenario.id);
    },
    [wealthFacts]
  );

  const loadScenario = useCallback(
    (id: string) => {
      const s = scenarios.find((x) => x.id === id);
      if (!s) return;
      setWealthFacts(structuredClone(s.facts));
      setActiveScenarioId(id);
      setUseLedgerForCash(false);
    },
    [scenarios]
  );

  const deleteScenario = useCallback(
    (id: string) => {
      setScenarios((prev) => prev.filter((s) => s.id !== id));
      setActiveScenarioId((cur) => (cur === id ? null : cur));
    },
    []
  );

  const duplicateScenario = useCallback((id: string) => {
    setScenarios((prev) => {
      const s = prev.find((x) => x.id === id);
      if (!s) return prev;
      const now = Date.now();
      return [
        { ...structuredClone(s), id: `s-${now}-${Math.random().toString(36).slice(2, 7)}`, name: `${s.name} (copy)`, createdAt: now, updatedAt: now },
        ...prev,
      ];
    });
  }, []);

  const renameScenario = useCallback((id: string, name: string, summary: string) => {
    setScenarios((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name, summary: summary.trim(), updatedAt: Date.now() } : s))
    );
  }, []);

  const value: AppState = {
    transactions,
    addTransactions,
    clearTransactions,
    madhhab,
    setMadhhab,
    wealthFacts: effectiveWealth,
    setWealthFacts,
    nisab,
    setNisab,
    threshold,
    openingBalance,
    setOpeningBalance,
    useLedgerForCash,
    setUseLedgerForCash,
    acknowledged,
    toggleAcknowledged,
    importedAssets,
    applyWorkbook,
    scenarios,
    activeScenarioId,
    saveScenario,
    loadScenario,
    deleteScenario,
    duplicateScenario,
    renameScenario,
    classification,
    balanceSeries,
    zakat,
    blockingIds,
    hasLedger,
    theme,
    toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
