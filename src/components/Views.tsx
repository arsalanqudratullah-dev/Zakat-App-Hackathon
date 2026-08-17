/**
 * The six main screens of the app (Ledger, Holdings, Assessment,
 * Scenarios, Review, Rulings). Consolidated from the former
 * src/components/{LedgerPage,HoldingsPage,AssessmentPage,ScenariosPage,
 * ReviewPage,RulingsPage}.tsx. Each stays a fully separate exported
 * component, just relocated into one file rather than deleted.
 */
import { Fragment, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { useApp } from '../store';
import {
  Panel,
  PanelHeader,
  Button,
  Field,
  Input,
  Select,
  MoneyInput,
  Toggle,
  Notice,
  StatusBadge,
  EmptyState,
  Stat,
} from './ui';
import { ClassificationBar, CompositionPie, HawlTimeline, ZakatWaterfall } from './Charts';
import type { Route } from './AppShell';
import * as M from '../engine';
import {
  usingUmmAlQura,
  GOLD_NISAB_GRAMS,
  SILVER_NISAB_GRAMS,
  GOLD_SILVER_CATEGORY_LABELS,
  goldNisabValue,
  silverNisabValue,
  holdingValue,
} from '../engine';
import type { GoldSilverCategory, MetalHolding } from '../engine';
import { parseTransactionsCsv } from '../data';
import { parseWorkbook } from '../xlsxImport';
import type { ImportedAsset } from '../xlsxImport';
import { scenarioTemplates } from '../data';
import { computeZakat, MADHHAB_FORMULAS } from '../zakatCalculator';
import {
  normalizeRow,
  MADHHAB_LABELS,
  MADHHAB_ORDER,
  CLASSIFICATION_LABELS,
  CLASSIFICATION_ORDER,
  DEBT_BUCKET_LABELS,
  DEBT_CATEGORY_LABELS,
  RECEIVABLE_TYPE_LABELS,
} from '../types';
import type {
  RawTransactionRow,
  Classification,
  Madhhab,
  DebtDueBucket,
  DebtCategory,
  ReceivableType,
  WealthFacts,
} from '../types';

// ============================= Ledger (LedgerPage.tsx) =============================
const ORDER_FOR_PIE: Classification[] = ['halal', 'mixed', 'tentative', 'missing_information', 'haram'];

const CATEGORIES = [
  { keyword: 'salary_income', label: 'Salary', type: 'income' },
  { keyword: 'freelance_income', label: 'Freelance work', type: 'income' },
  { keyword: 'business_sale_income', label: 'Business sale', type: 'income' },
  { keyword: 'rental_income', label: 'Rent received', type: 'income' },
  { keyword: 'tip_income', label: 'Tips', type: 'income' },
  { keyword: 'commission_income', label: 'Commission', type: 'income' },
  { keyword: 'content_revenue_income', label: 'Content revenue', type: 'income' },
  { keyword: 'scholarship_income', label: 'Scholarship', type: 'income' },
  { keyword: 'gift_income', label: 'Gift received', type: 'income' },
  { keyword: 'interest_income', label: 'Bank interest', type: 'income' },
  { keyword: 'alcohol_sales_income', label: 'Alcohol sales', type: 'income' },
  { keyword: 'gambling_income', label: 'Gambling winnings', type: 'income' },
  { keyword: 'mixed_income_disposed', label: 'Mixed, haram share disposed of', type: 'income', mixed: true },
  { keyword: 'mixed_income_retained', label: 'Mixed, kept in full', type: 'income', mixed: true },
  { keyword: 'personal_spending', label: 'Spending', type: 'expense' },
] as const;

export function LedgerPage() {
  const { transactions, classification, blockingIds, acknowledged, toggleAcknowledged } = useApp();
  const [filter, setFilter] = useState<Classification | 'all'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = useMemo(
    () => (filter === 'all' ? classification.lines : classification.lines.filter((l) => l.classification === filter)),
    [classification.lines, filter]
  );

  if (transactions.length === 0) {
    return (
      <div className="space-y-5">
        <ImportPanel />
        <ManualEntry />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {blockingIds.length > 0 && (
        <Notice tone="warning" title={`${blockingIds.length} transaction${blockingIds.length === 1 ? '' : 's'} cannot be classified`}>
          These records are missing information the rules need. Supply the missing detail, or acknowledge each one to
          continue with it excluded from the assessment.
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <ClassificationBar summary={classification} />
        <CompositionPie
          title="Share of classified income"
          caption="The same figures as a proportion of the whole."
          centreLabel="Classified"
          slices={ORDER_FOR_PIE.filter((c) => !M.isZero(classification.totalsByClassification[c])).map((c) => ({
            key: c,
            label: CLASSIFICATION_LABELS[c],
            value: classification.totalsByClassification[c],
            token: c === 'missing_information' ? '--data-unknown' : `--data-${c}`,
          }))}
        />
      </div>

      <ImportPanel compact />

      <Panel>
        <PanelHeader
          title="Transactions"
          description="Select any row to see which rule decided it and why."
          actions={
            <div className="flex flex-wrap gap-1">
              <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={classification.lines.length} />
              {CLASSIFICATION_ORDER.filter((c) => classification.counts[c] > 0).map((c) => (
                <FilterChip
                  key={c}
                  active={filter === c}
                  onClick={() => setFilter(c)}
                  label={CLASSIFICATION_LABELS[c]}
                  count={classification.counts[c]}
                />
              ))}
            </div>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--line-soft)] text-left text-[11px] uppercase tracking-wide text-[var(--ink-mute)]">
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Description</th>
                <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th className="px-3 py-2.5 text-right font-medium">Counted</th>
                <th className="px-3 py-2.5 font-medium">Verdict</th>
                <th className="w-8 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="stagger">
              {visible.map((l) => {
                const open = expanded === l.transactionId;
                const counted =
                  l.classification === 'haram'
                    ? M.format(l.haramAmount)
                    : M.isZero(l.halalAmount)
                      ? '·'
                      : M.format(l.halalAmount);
                return (
                  <Fragment key={l.transactionId}>
                    <tr
                      onClick={() => setExpanded(open ? null : l.transactionId)}
                      className="cursor-pointer border-b border-[var(--line-soft)] transition-colors duration-150 hover:bg-[var(--ground)]"
                    >
                      <td className="whitespace-nowrap px-5 py-2.5 tnum text-[var(--ink-mute)]">{l.date}</td>
                      <td className="max-w-[280px] px-3 py-2.5">
                        <span className="block truncate text-[var(--ink)]">{l.description || l.keyword.replace(/_/g, ' ')}</span>
                        <span className="block truncate text-[11.5px] text-[var(--ink-mute)]">{l.merchantOrSource}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tnum text-[var(--ink-soft)]">
                        {M.format(l.amountCad)}
                      </td>
                      <td
                        className="whitespace-nowrap px-3 py-2.5 text-right tnum"
                        style={{
                          color:
                            l.classification === 'haram'
                              ? 'var(--data-haram)'
                              : M.isZero(l.halalAmount)
                                ? 'var(--ink-mute)'
                                : 'var(--data-halal)',
                        }}
                      >
                        {counted}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={l.classification} />
                      </td>
                      <td className="px-3 py-2.5 text-[var(--ink-mute)]">
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          className="transition-transform duration-300"
                          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
                          aria-hidden
                        >
                          <path d="M2.5 4.5L6 8l3.5-3.5" strokeLinecap="round" />
                        </svg>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-[var(--line-soft)] bg-[var(--ground)]">
                        <td colSpan={6} className="px-5 py-4">
                          <div className="animate-fade max-w-3xl">
                            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>
                              {l.ruleCited}
                            </p>
                            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--ink-soft)]">{l.explanation}</p>
                            {l.netAdjustment && (
                              <p className="mt-2 text-[12px] text-[var(--ink-mute)]">
                                Adjustment: {l.netAdjustment}
                                {l.linkedTo?.length ? ` · linked to ${l.linkedTo.join(', ')}` : ''}
                              </p>
                            )}
                            {l.importIssue && (
                              <p className="mt-2 text-[12px]" style={{ color: 'var(--data-mixed)' }}>
                                Import issue: {l.importIssue}
                              </p>
                            )}
                            {l.classification === 'missing_information' && (
                              <label className="mt-3 flex items-center gap-2 text-[12.5px] text-[var(--ink-soft)]">
                                <input
                                  type="checkbox"
                                  checked={acknowledged.has(l.transactionId)}
                                  onChange={() => toggleAcknowledged(l.transactionId)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="accent-[var(--accent)]"
                                />
                                Acknowledge and continue without this record
                              </label>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <ManualEntry />
    </div>
  );
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-all duration-200 ${
        active
          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'border-[var(--line)] text-[var(--ink-mute)] hover:text-[var(--ink-soft)]'
      }`}
    >
      {label} <span className="tnum opacity-65">{count}</span>
    </button>
  );
}

function ImportPanel({ compact = false }: { compact?: boolean }) {
  const { addTransactions, applyWorkbook, transactions, clearTransactions } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  function handleFile(file: File) {
    if (/\.xlsx?$/i.test(file.name)) return handleWorkbook(file);
    handleCsv(file);
  }

  /** Multi-sheet workbook: Transactions, Assets, Debts, and Wealth_History. */
  function handleWorkbook(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = parseWorkbook(reader.result as ArrayBuffer);
        if (!result.transactions.length && !result.assets.length) {
          setMessage({ tone: 'error', text: 'No Transactions or Assets rows were found in that workbook.' });
          return;
        }
        const added = applyWorkbook(result);
        const parts = [
          `${added} transaction${added === 1 ? '' : 's'}`,
          result.assets.length ? `${result.assets.length} assets` : '',
          result.debts.length ? `${result.debts.length} debts` : '',
          result.history.length ? `${result.history.length} monthly snapshots` : '',
        ].filter(Boolean);
        setMessage({
          tone: 'ok',
          text: `Imported ${parts.join(', ')} from ${file.name}.${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`,
        });
      } catch {
        setMessage({ tone: 'error', text: 'That workbook could not be read. Check it is a valid .xlsx file.' });
      }
    };
    reader.onerror = () => setMessage({ tone: 'error', text: 'That file could not be read.' });
    reader.readAsArrayBuffer(file);
  }

  function handleCsv(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const { transactions: parsed, errors, missingHeaders } = parseTransactionsCsv(String(reader.result ?? ''));
      if (missingHeaders.length) {
        setMessage({ tone: 'error', text: `Missing required column${missingHeaders.length > 1 ? 's' : ''}: ${missingHeaders.join(', ')}` });
        return;
      }
      const added = addTransactions(parsed);
      const skipped = parsed.length - added;
      setMessage({
        tone: 'ok',
        text: `Imported ${added} record${added === 1 ? '' : 's'} from ${file.name}${skipped > 0 ? ` · ${skipped} already present` : ''}${errors.length ? ` · ${errors.length} row${errors.length === 1 ? '' : 's'} malformed` : ''}`,
      });
    };
    reader.onerror = () => setMessage({ tone: 'error', text: 'That file could not be read.' });
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const template: RawTransactionRow[] = [
      {
        person_name: 'Your name',
        transaction_id: 'TX0001',
        date: new Date().toISOString().slice(0, 10),
        keyword: 'salary_income',
        amount_cad: '3550.00',
        direction: 'inflow',
        transaction_type: 'income',
        merchant_or_source: 'Employer',
        description: 'Monthly salary',
        account: 'CHEQUING',
        scope: 'personal',
        status: 'posted',
        mixed_halal_pct: '',
        haram_portion_disposed: '',
        cost_basis_cad: '',
        related_reference: '',
        missing_information: '',
      },
    ];
    const blob = new Blob([Papa.unparse(template)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mizan-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (transactions.length === 0 && !compact) {
    return (
      <Panel>
        <PanelHeader title="Import your records" description="A CSV of transactions, or a multi-sheet .xlsx workbook with Transactions, Assets, Debts and Wealth History." />
        <div className="px-5 py-6">
          <EmptyState
            title="No transactions yet"
            description="Import a CSV or an .xlsx workbook to begin, or add records by hand below. Nothing leaves this device; the assessment runs entirely in your browser."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => fileRef.current?.click()}>
                  Choose a CSV or Excel file
                </Button>
                <Button onClick={downloadTemplate}>Download template</Button>
              </div>
            }
          />
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          {message && (
            <p className="mt-4 text-center text-[12.5px]" style={{ color: message.tone === 'ok' ? 'var(--data-halal)' : 'var(--data-haram)' }}>
              {message.text}
            </p>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Import" description="Add another export, or start over." />
      <div className="flex flex-1 flex-col gap-3 px-5 py-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => fileRef.current?.click()}>
            Choose a CSV or Excel file
          </Button>
          <Button onClick={downloadTemplate}>Template</Button>
          <Button
            variant="danger"
            className="ml-auto"
            onClick={() => {
              if (confirm('Remove all imported transactions? Saved scenarios are kept.')) {
                clearTransactions();
                setMessage(null);
              }
            }}
          >
            Clear ledger
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
        {message && (
          <p className="text-[12.5px]" style={{ color: message.tone === 'ok' ? 'var(--data-halal)' : 'var(--data-haram)' }}>
            {message.text}
          </p>
        )}
        <p className="mt-auto text-[11.5px] leading-relaxed text-[var(--ink-mute)]">
          Expected columns: person_name, transaction_id, date, keyword, amount_cad, direction, transaction_type,
          merchant_or_source, description, account, scope, status, plus optional mixed_halal_pct,
          haram_portion_disposed, cost_basis_cad, related_reference, missing_information.
        </p>
      </div>
    </Panel>
  );
}

function ManualEntry() {
  const { addTransactions } = useApp();
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [cents, setCents] = useState(0);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState('');
  const [description, setDescription] = useState('');
  const [pct, setPct] = useState(70);

  const category = CATEGORIES[categoryIdx];
  const isMixed = 'mixed' in category && category.mixed === true;
  const canSubmit = cents > 0 && date !== '';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    addTransactions([
      normalizeRow(
        {
          person_name: 'Manual entry',
          transaction_id: `MAN-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          date,
          keyword: category.keyword,
          amount_cad: (cents / 100).toFixed(2),
          direction: category.type === 'expense' ? 'outflow' : 'inflow',
          transaction_type: category.type,
          merchant_or_source: source || '·',
          description: description || category.label,
          account: 'MANUAL',
          scope: 'personal',
          status: 'posted',
          mixed_halal_pct: isMixed ? String(pct) : '',
          haram_portion_disposed: isMixed ? (category.keyword === 'mixed_income_disposed' ? 'yes' : 'no') : '',
        },
        'manual'
      ),
    ]);
    setCents(0);
    setSource('');
    setDescription('');
  }

  return (
    <Panel as="div">
      <PanelHeader title="Add a record" description="For anything not in your export." />
      <form onSubmit={submit} className="grid gap-3.5 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Category" className="sm:col-span-2 lg:col-span-1">
          <Select value={categoryIdx} onChange={(e) => setCategoryIdx(Number(e.target.value))}>
            {CATEGORIES.map((c, i) => (
              <option key={c.keyword} value={i}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (CAD)">
          <MoneyInput cents={cents} onCents={setCents} />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Source">
          <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Employer, client, tenant…" />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </Field>
        {isMixed && (
          <Field label="Permissible share" hint={`${pct}% halal · ${100 - pct}% impermissible`}>
            <Input type="range" min={0} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="px-0" />
          </Field>
        )}
        <div className={`flex items-end ${isMixed ? '' : 'sm:col-span-2 lg:col-span-2'}`}>
          <Button type="submit" variant="primary" disabled={!canSubmit} className="w-full sm:w-auto">
            Add record
          </Button>
        </div>
      </form>
    </Panel>
  );
}

// =========================== Holdings (HoldingsPage.tsx) ===========================
const uid = () => Math.random().toString(36).slice(2, 10);


/**
 * Every row of an imported Assets sheet with the verdict the rules produced.
 * Rows that carry no zakat weight (haram, or unresolved) are shown struck
 * through with the reason, so an excluded asset is visibly excluded rather
 * than silently missing from the totals.
 */
function ImportedAssetsPanel({ assets }: { assets: ImportedAsset[] }) {
  if (assets.length === 0) return null;

  const counted = assets.filter((a) => a.classification === 'halal' || a.classification === 'mixed');
  const excluded = assets.filter((a) => a.classification === 'haram');
  const held = assets.filter((a) => a.classification === 'tentative' || a.classification === 'missing_information');

  const total = (rows: ImportedAsset[]) => M.sum(rows.map((r) => r.amount));

  return (
    <Panel>
      <PanelHeader
        title="Imported assets"
        description="Each row from the workbook's Assets sheet, with the rule that decided it."
        actions={
          <span className="tnum text-[12.5px] text-[var(--ink-soft)]">
            {M.format(total(counted))} counted
          </span>
        }
      />

      <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
        <Stat label="Enters zakat base" value={M.format(total(counted))} sub={`${counted.length} asset${counted.length === 1 ? '' : 's'}`} tone="halal" />
        <Stat label="Excluded as impermissible" value={M.format(total(excluded))} sub={`${excluded.length} asset${excluded.length === 1 ? '' : 's'}`} tone="haram" />
        <Stat label="Held for review" value={M.format(total(held))} sub={`${held.length} asset${held.length === 1 ? '' : 's'}`} tone="tentative" />
      </div>

      <ul className="divide-y divide-[var(--line-soft)] border-t border-[var(--line-soft)]">
        {assets.map((a) => {
          const countsToward = a.classification === 'halal' || a.classification === 'mixed';
          return (
            <li key={a.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] text-[var(--ink)]">
                      {a.description || a.keyword.replace(/_/g, ' ')}
                    </span>
                    <StatusBadge status={a.classification} />
                    <span className="text-[11px] uppercase tracking-wide text-[var(--ink-mute)]">{a.ruleCited}</span>
                  </div>
                  <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-[var(--ink-soft)]">{a.explanation}</p>
                  {a.missingInformation && (
                    <p className="mt-1 text-[11.5px] text-[var(--ink-mute)]">Missing: {a.missingInformation}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 tnum text-[13.5px] ${countsToward ? 'text-[var(--ink)]' : 'text-[var(--ink-mute)] line-through'}`}
                >
                  {M.format(a.amount)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function HoldingsPage() {
  const { wealthFacts, setWealthFacts, nisab, setNisab, hasLedger, useLedgerForCash, setUseLedgerForCash, balanceSeries, openingBalance, setOpeningBalance, importedAssets } =
    useApp();

  const patch = (p: Partial<WealthFacts>) => setWealthFacts({ ...wealthFacts, ...p });

  return (
    <div className="space-y-5">
      <ImportedAssetsPanel assets={importedAssets} />

      <Panel>
        <PanelHeader
          title="Nisab"
          description="The threshold is a weight of metal, so it is derived from the fixed price you set here, never from a live rate."
        />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
          <Field label="Gold price (CAD per gram)" hint={`${GOLD_NISAB_GRAMS} g → ${M.format(goldNisabValue(nisab))}`}>
            <MoneyInput cents={nisab.goldPerGramCad} onCents={(c) => setNisab({ ...nisab, goldPerGramCad: c as never })} />
          </Field>
          <Field label="Silver price (CAD per gram)" hint={`${SILVER_NISAB_GRAMS} g → ${M.format(silverNisabValue(nisab))}`}>
            <MoneyInput cents={nisab.silverPerGramCad} onCents={(c) => setNisab({ ...nisab, silverPerGramCad: c as never })} />
          </Field>
          <Field
            label="Measure against"
            hint={nisab.basis === 'silver' ? 'The lower threshold, the cautious choice.' : 'The higher threshold.'}
          >
            <Select value={nisab.basis} onChange={(e) => setNisab({ ...nisab, basis: e.target.value as 'gold' | 'silver' })}>
              <option value="silver">Silver nisab</option>
              <option value="gold">Gold nisab</option>
            </Select>
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Liquid wealth" description="Cash, investments, and stock held for sale." />
        <div className="space-y-4 px-5 py-4">
          {hasLedger && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--ground)] px-4 py-3">
              <Toggle checked={useLedgerForCash} onChange={setUseLedgerForCash} label="Take cash from the ledger balance" />
              <span className="tnum text-[13px] text-[var(--ink-soft)]">
                Ledger closes at {M.format(balanceSeries.closingBalance)}
              </span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {hasLedger && useLedgerForCash ? (
              <Field label="Cash and bank" hint="Derived from the ledger. Turn the toggle off to set it by hand.">
                <Input value={M.format(wealthFacts.cash)} readOnly className="opacity-70" />
              </Field>
            ) : (
              <Field label="Cash and bank">
                <MoneyInput cents={wealthFacts.cash} onCents={(c) => patch({ cash: c as never })} />
              </Field>
            )}
            <Field label="Business inventory" hint="Stock held for sale.">
              <MoneyInput cents={wealthFacts.businessInventory} onCents={(c) => patch({ businessInventory: c as never })} />
            </Field>
            <Field label="Halal investments" hint="Excluding listed shares.">
              <MoneyInput
                cents={wealthFacts.halalInvestmentsExclStocks}
                onCents={(c) => patch({ halalInvestmentsExclStocks: c as never })}
              />
            </Field>
            <Field label="Shares held" hint="Screened listed shares not yet sold.">
              <MoneyInput
                cents={wealthFacts.screenedStockShareValue}
                onCents={(c) => patch({ screenedStockShareValue: c as never })}
              />
            </Field>
          </div>

          {hasLedger && useLedgerForCash && (
            <Field label="Opening balance before the first record" hint="Wealth already held when the ledger begins.">
              <div className="max-w-[240px]">
                <MoneyInput cents={openingBalance} onCents={(c) => setOpeningBalance(c as never)} />
              </div>
            </Field>
          )}
        </div>
      </Panel>

      <MetalsPanel />
      <DebtsPanel />
      <ReceivablesPanel />

      {!hasLedger && (
        <Notice tone="info" title="Holding period">
          Without a dated ledger the holding period cannot be derived, so the assessment falls back to what you state
          on the Assessment screen. Import transactions to have it worked out from your actual balances.
        </Notice>
      )}
    </div>
  );
}

function MetalsPanel() {
  const { wealthFacts, setWealthFacts, nisab } = useApp();
  const metals = wealthFacts.metals;

  const update = (i: number, p: Partial<MetalHolding>) => {
    const next = [...metals];
    next[i] = { ...next[i], ...p };
    setWealthFacts({ ...wealthFacts, metals: next });
  };

  const total = M.sum(metals.map((h) => holdingValue(h, nisab)));

  return (
    <Panel>
      <PanelHeader
        title="Gold and silver"
        description="Entered by weight and purity, so only the metal is valued, gemstones and settings are excluded automatically."
        actions={
          <>
            {metals.length > 0 && <span className="tnum text-[13px] text-[var(--ink-soft)]">{M.format(total)}</span>}
            <Button
              onClick={() =>
                setWealthFacts({
                  ...wealthFacts,
                  metals: [
                    ...metals,
                    { id: uid(), label: '', metal: 'gold', grams: 0, purity: 24, category: 'bars_bullion_coins' },
                  ],
                })
              }
            >
              Add item
            </Button>
          </>
        }
      />
      <div className="px-5 py-4">
        {metals.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-[var(--ink-mute)]">No gold or silver recorded.</p>
        ) : (
          <ul className="stagger space-y-3">
            {metals.map((h, i) => (
              <li key={h.id} className="grid gap-2.5 rounded-lg border border-[var(--line-soft)] p-3 lg:grid-cols-[1.4fr_auto_auto_auto_1.6fr_auto_auto]">
                <Input placeholder="Description" value={h.label} onChange={(e) => update(i, { label: e.target.value })} />
                <Select value={h.metal} onChange={(e) => update(i, { metal: e.target.value as 'gold' | 'silver' })} className="lg:w-[95px]">
                  <option value="gold">Gold</option>
                  <option value="silver">Silver</option>
                </Select>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Grams"
                  value={h.grams || ''}
                  onChange={(e) => update(i, { grams: Number(e.target.value) })}
                  className="lg:w-[95px]"
                />
                <Select value={h.purity} onChange={(e) => update(i, { purity: Number(e.target.value) })} className="lg:w-[105px]">
                  {[24, 22, 21, 18, 14, 10].map((k) => (
                    <option key={k} value={k}>
                      {k}k
                    </option>
                  ))}
                </Select>
                <Select
                  value={h.category}
                  onChange={(e) => update(i, { category: e.target.value as GoldSilverCategory })}
                >
                  {(Object.keys(GOLD_SILVER_CATEGORY_LABELS) as GoldSilverCategory[]).map((c) => (
                    <option key={c} value={c}>
                      {GOLD_SILVER_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
                <div className="flex items-center gap-3">
                  <span className="tnum whitespace-nowrap text-[12.5px] text-[var(--ink-soft)]">
                    {M.format(holdingValue(h, nisab))}
                  </span>
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-[var(--ink-mute)]">
                    <input
                      type="checkbox"
                      checked={!!h.borderline}
                      onChange={(e) => update(i, { borderline: e.target.checked })}
                      className="accent-[var(--accent)]"
                    />
                    Unsure
                  </label>
                </div>
                <Button
                  variant="ghost"
                  aria-label="Remove item"
                  onClick={() => setWealthFacts({ ...wealthFacts, metals: metals.filter((x) => x.id !== h.id) })}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function DebtsPanel() {
  const { wealthFacts, setWealthFacts } = useApp();
  const debts = wealthFacts.debts;

  return (
    <Panel>
      <PanelHeader
        title="Debts you owe"
        description="Which of these reduce your zakatable wealth depends entirely on the school you follow."
        actions={
          <>
            {debts.length > 0 && (
              <span className="tnum text-[13px] text-[var(--ink-soft)]">{M.format(M.sum(debts.map((d) => d.amount)))}</span>
            )}
            <Button
              onClick={() =>
                setWealthFacts({
                  ...wealthFacts,
                  debts: [
                    ...debts,
                    { id: uid(), label: '', amount: M.ZERO, dueBucket: 'due_now_or_overdue', category: 'credit_card' },
                  ],
                })
              }
            >
              Add debt
            </Button>
          </>
        }
      />
      <div className="px-5 py-4">
        {debts.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-[var(--ink-mute)]">No debts recorded.</p>
        ) : (
          <ul className="stagger space-y-3">
            {debts.map((d, i) => (
              <li key={d.id} className="grid gap-2.5 rounded-lg border border-[var(--line-soft)] p-3 lg:grid-cols-[1.5fr_1fr_1.3fr_auto_auto]">
                <Input
                  placeholder="Description"
                  value={d.label}
                  onChange={(e) => {
                    const next = [...debts];
                    next[i] = { ...d, label: e.target.value };
                    setWealthFacts({ ...wealthFacts, debts: next });
                  }}
                />
                <Select
                  value={d.category}
                  onChange={(e) => {
                    const next = [...debts];
                    next[i] = { ...d, category: e.target.value as DebtCategory };
                    setWealthFacts({ ...wealthFacts, debts: next });
                  }}
                >
                  {(Object.keys(DEBT_CATEGORY_LABELS) as DebtCategory[]).map((c) => (
                    <option key={c} value={c}>
                      {DEBT_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
                <Select
                  value={d.dueBucket}
                  onChange={(e) => {
                    const next = [...debts];
                    next[i] = { ...d, dueBucket: e.target.value as DebtDueBucket };
                    setWealthFacts({ ...wealthFacts, debts: next });
                  }}
                >
                  {(Object.keys(DEBT_BUCKET_LABELS) as DebtDueBucket[]).map((b) => (
                    <option key={b} value={b}>
                      {DEBT_BUCKET_LABELS[b]}
                    </option>
                  ))}
                </Select>
                <div className="lg:w-[130px]">
                  <MoneyInput
                    cents={d.amount}
                    onCents={(c) => {
                      const next = [...debts];
                      next[i] = { ...d, amount: c as never };
                      setWealthFacts({ ...wealthFacts, debts: next });
                    }}
                  />
                </div>
                <Button
                  variant="ghost"
                  aria-label="Remove debt"
                  onClick={() => setWealthFacts({ ...wealthFacts, debts: debts.filter((x) => x.id !== d.id) })}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function ReceivablesPanel() {
  const { wealthFacts, setWealthFacts } = useApp();
  const items = wealthFacts.receivables;

  return (
    <Panel>
      <PanelHeader
        title="Owed to you"
        description="Money lent out and unpaid invoices are treated very differently from one school to the next."
        actions={
          <>
            {items.length > 0 && (
              <span className="tnum text-[13px] text-[var(--ink-soft)]">{M.format(M.sum(items.map((r) => r.amount)))}</span>
            )}
            <Button
              onClick={() =>
                setWealthFacts({
                  ...wealthFacts,
                  receivables: [
                    ...items,
                    {
                      id: uid(),
                      label: '',
                      amount: M.ZERO,
                      type: 'business_sale_or_invoice',
                      expectedRepayment: 'likely',
                      receivedThisYear: false,
                    },
                  ],
                })
              }
            >
              Add entry
            </Button>
          </>
        }
      />
      <div className="px-5 py-4">
        {items.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-[var(--ink-mute)]">Nothing recorded as owed to you.</p>
        ) : (
          <ul className="stagger space-y-3">
            {items.map((r, i) => {
              const update = (p: Partial<typeof r>) => {
                const next = [...items];
                next[i] = { ...r, ...p };
                setWealthFacts({ ...wealthFacts, receivables: next });
              };
              return (
                <li key={r.id} className="grid gap-2.5 rounded-lg border border-[var(--line-soft)] p-3 lg:grid-cols-[1.4fr_1.5fr_1fr_auto_auto_auto]">
                  <Input placeholder="Description" value={r.label} onChange={(e) => update({ label: e.target.value })} />
                  <Select value={r.type} onChange={(e) => update({ type: e.target.value as ReceivableType })}>
                    {(Object.keys(RECEIVABLE_TYPE_LABELS) as ReceivableType[]).map((t) => (
                      <option key={t} value={t}>
                        {RECEIVABLE_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={r.expectedRepayment}
                    onChange={(e) => update({ expectedRepayment: e.target.value as 'likely' | 'doubtful' })}
                  >
                    <option value="likely">Likely repaid</option>
                    <option value="doubtful">Doubtful</option>
                  </Select>
                  <div className="lg:w-[130px]">
                    <MoneyInput cents={r.amount} onCents={(c) => update({ amount: c as never })} />
                  </div>
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-[var(--ink-mute)]">
                    <input
                      type="checkbox"
                      checked={!!r.receivedThisYear}
                      onChange={(e) => update({ receivedThisYear: e.target.checked })}
                      className="accent-[var(--accent)]"
                    />
                    Received
                  </label>
                  <Button
                    variant="ghost"
                    aria-label="Remove entry"
                    onClick={() => setWealthFacts({ ...wealthFacts, receivables: items.filter((x) => x.id !== r.id) })}
                  >
                    ×
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

// ========================= Assessment (AssessmentPage.tsx) =========================
const ASSET_TOKENS = ['--ramp-2', '--ramp-3', '--ramp-4', '--ramp-5', '--ramp-1'];

export function AssessmentPage({ onRoute }: { onRoute: (r: Route) => void }) {
  const {
    zakat,
    classification,
    madhhab,
    blockingIds,
    hasLedger,
    balanceSeries,
    threshold,
    wealthFacts,
    setWealthFacts,
    transactions,
  } = useApp();

  const nothingEntered =
    transactions.length === 0 &&
    M.isZero(wealthFacts.cash) &&
    M.isZero(wealthFacts.businessInventory) &&
    wealthFacts.metals.length === 0;

  if (nothingEntered) {
    return (
      <EmptyState
        title="Nothing to assess yet"
        description="Import a ledger or record what you hold, and the assessment will build here, with the reasoning behind every figure."
        action={
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => onRoute('ledger')}>
              Import a ledger
            </Button>
            <Button onClick={() => onRoute('wealth')}>Enter holdings</Button>
          </div>
        }
      />
    );
  }

  const due = zakat.zakatDue;
  const belowNisab = !zakat.meetsNisab;
  const payableNow = zakat.meetsNisab && zakat.hawl.satisfied;
  const blocked = blockingIds.length > 0;
  const rawTotal = M.sum(zakat.breakdown.filter((l) => !l.informational).map((l) => l.amount));

  return (
    <div className="space-y-5">
      <Panel className="overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
          <div className="border-b border-[var(--line-soft)] px-6 py-7 md:border-b-0 md:border-r">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-mute)]">
              {payableNow ? 'Zakat due' : belowNisab ? 'Zakat due' : 'Zakat on current wealth'} · {MADHHAB_LABELS[madhhab]}
            </p>
            <p
              className="animate-rise mt-2 font-display text-[46px] leading-none"
              style={{ color: belowNisab ? 'var(--ink-mute)' : payableNow ? 'var(--accent)' : 'var(--ink)' }}
            >
              {M.format(belowNisab ? M.ZERO : zakat.zakatOnWealth)}
            </p>
            <p className="mt-3 max-w-md text-[13px] leading-relaxed text-[var(--ink-soft)]">
              {belowNisab
                ? `Wealth of ${M.format(zakat.zakatableWealth)} sits below the ${zakat.nisabBasis} nisab threshold of ${M.format(zakat.nisabThreshold)}, so no zakat falls due.`
                : `2.5% of ${M.format(zakat.zakatableWealth)} in zakatable wealth, assessed against the ${zakat.nisabBasis} nisab of ${M.format(zakat.nisabThreshold)}.`}
            </p>
            {!belowNisab && !payableNow && (
              <p
                className="mt-2 max-w-md text-[12.5px] leading-relaxed"
                style={{ color: 'var(--data-mixed)' }}
              >
                {zakat.hawl.indeterminate
                  ? 'Not confirmed as payable yet: the holding period could not be established. See below.'
                  : `Not payable yet: the lunar year completes on ${zakat.hawl.dueDate ?? 'a later date'}.`}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-px bg-[var(--line-soft)]">
            <MiniStat label="Zakatable wealth" value={M.format(zakat.zakatableWealth)} />
            <MiniStat label="Nisab threshold" value={M.format(zakat.nisabThreshold)} note={`${zakat.nisabBasis} basis`} />
            <MiniStat
              label="Holding period"
              value={
                zakat.hawl.indeterminate
                  ? zakat.hawl.satisfied
                    ? 'Stated by you'
                    : 'Not established'
                  : zakat.hawl.satisfied
                    ? 'Complete'
                    : 'Incomplete'
              }
              tone={zakat.hawl.satisfied ? (zakat.hawl.indeterminate ? 'mixed' : 'halal') : 'mixed'}
            />
            <MiniStat
              label="Meets nisab"
              value={zakat.meetsNisab ? 'Yes' : 'No'}
              tone={zakat.meetsNisab ? 'halal' : 'mixed'}
            />
          </div>
        </div>
      </Panel>

      {blocked && (
        <Notice tone="warning" title="This assessment is provisional">
          {blockingIds.length} record{blockingIds.length === 1 ? '' : 's'} could not be classified and {blockingIds.length === 1 ? 'is' : 'are'} excluded
          entirely from the figures above. Resolve or acknowledge {blockingIds.length === 1 ? 'it' : 'them'} on the Ledger screen for a final number.
        </Notice>
      )}

      <Panel>
        <PanelHeader
          title="Holding period"
          description={`${MADHHAB_LABELS[madhhab]}, ${zakat.hawl.rule === 'endpoints' ? 'measured at the start and end of the lunar year; a dip in between does not reset it.' : 'requires an unbroken lunar year; any dip below nisab resets it.'}`}
        />
        <div className="space-y-4 px-5 py-4">
          <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--ink-soft)]">{zakat.hawl.explanation}</p>

          {zakat.hawl.indeterminate && !belowNisab && <HawlAssertions />}

          {hasLedger && <HawlTimeline series={balanceSeries} hawl={zakat.hawl} nisabThreshold={threshold} />}

          {!hasLedger && !zakat.hawl.indeterminate && <HawlAssertions />}

          {hasLedger && (
            <p className="text-[11.5px] text-[var(--ink-mute)]">
              Lunar dates via the {usingUmmAlQura ? 'Umm al-Qura' : 'tabular Islamic'} calendar. A lunar year runs about
              354 days, so the anniversary moves earlier against the Gregorian calendar each year.
            </p>
          )}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <ZakatWaterfall result={zakat} />
        <CompositionPie
          title="What the wealth is made of"
          caption="Only the assets this school counts. Deductions are shown in the waterfall, not here."
          centreLabel="Assets"
          slices={zakat.breakdown
            .filter((l) => !l.informational && !M.isNegative(l.amount) && !M.isZero(l.amount))
            .map((l, i) => ({
              key: l.label,
              label: l.label,
              value: l.amount,
              token: ASSET_TOKENS[i % ASSET_TOKENS.length],
            }))}
        />
      </div>

      <Panel>
        <PanelHeader title="Calculation" description={zakat.formula} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--line-soft)] text-left text-[11px] uppercase tracking-wide text-[var(--ink-mute)]">
                <th className="px-5 py-2.5 font-medium">Line</th>
                <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th className="px-5 py-2.5 text-right font-medium">Running total</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let running = M.ZERO;
                return zakat.breakdown.map((line, i) => {
                  if (!line.informational) running = M.add(running, line.amount);
                  return (
                    <tr key={i} className="border-b border-[var(--line-soft)] align-top">
                      <td className="px-5 py-3">
                        <span className="text-[var(--ink)]">{line.label}</span>
                        {line.note && (
                          <span className="mt-0.5 block max-w-lg text-[11.5px] leading-snug text-[var(--ink-mute)]">{line.note}</span>
                        )}
                      </td>
                      <td
                        className="whitespace-nowrap px-3 py-3 text-right tnum"
                        style={{ color: M.isNegative(line.amount) ? 'var(--data-haram)' : 'var(--ink-soft)' }}
                      >
                        {line.informational ? '·' : M.formatSigned(line.amount)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tnum font-medium text-[var(--ink)]">
                        {line.informational ? '' : M.format(running)}
                      </td>
                    </tr>
                  );
                });
              })()}
              {M.isNegative(rawTotal) && (
                <tr className="border-b border-[var(--line-soft)]">
                  <td className="px-5 py-3">
                    <span className="text-[var(--ink)]">Floored at zero</span>
                    <span className="mt-0.5 block max-w-lg text-[11.5px] leading-snug text-[var(--ink-mute)]">
                      Deductions exceed assets by {M.format(M.negate(rawTotal))}. Zakatable wealth cannot be negative,
                      so it is treated as nil. No zakat falls due, and nothing is carried forward.
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tnum text-[var(--ink-mute)]">
                    {M.formatSigned(M.negate(rawTotal))}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right tnum font-medium text-[var(--ink)]">
                    {M.format(zakat.zakatableWealth)}
                  </td>
                </tr>
              )}
              <tr className="bg-[var(--ground)]">
                <td className="px-5 py-3 font-medium text-[var(--ink)]">Zakat at 2.5%</td>
                <td />
                <td className="px-5 py-3 text-right tnum text-[15px] font-semibold" style={{ color: 'var(--accent)' }}>
                  {M.format(due)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      {!M.isZero(classification.totalHaram) && (
        <Panel>
          <PanelHeader
            title="Held separately"
            description="Not part of zakatable wealth. Return it to its owner where they can be identified, otherwise dispose of it without seeking reward. Disposing of it is not itself zakat."
            actions={
              <span className="tnum text-[15px] font-semibold" style={{ color: 'var(--data-haram)' }}>
                {M.format(classification.totalHaram)}
              </span>
            }
          />
          <ul className="divide-y divide-[var(--line-soft)]">
            {classification.lines
              .filter((l) => !M.isZero(l.haramAmount))
              .map((l) => (
                <li key={l.transactionId} className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-[13px]">
                  <span className="min-w-0">
                    <span className="text-[var(--ink)]">{l.description || l.keyword.replace(/_/g, ' ')}</span>
                    <span className="ml-2 tnum text-[11.5px] text-[var(--ink-mute)]">{l.date}</span>
                  </span>
                  <span className="tnum shrink-0" style={{ color: 'var(--data-haram)' }}>
                    {M.format(l.haramAmount)}
                  </span>
                </li>
              ))}
          </ul>
        </Panel>
      )}

      {zakat.scholarReviewNotes.length > 0 && (
        <Panel>
          <PanelHeader title="Noted for review" description={`Points the ${MADHHAB_LABELS[madhhab]} rules raise on your holdings.`} />
          <ul className="space-y-2.5 px-5 py-4">
            {zakat.scholarReviewNotes.map((n, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-[var(--ink-soft)]">
                <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full" style={{ background: 'var(--data-tentative)' }} />
                {n}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );

  function HawlAssertions() {
    const h = wealthFacts.hawl;
    const confirmed = h.atNisabAtStart && h.atNisabAtEnd && !h.dippedMidYear;
    return (
      <div
        className="space-y-3 rounded-lg border px-4 py-4"
        style={{
          borderColor: confirmed ? 'var(--line)' : 'color-mix(in oklab, var(--data-mixed) 40%, transparent)',
          background: confirmed ? 'var(--ground)' : 'color-mix(in oklab, var(--data-mixed) 7%, transparent)',
        }}
      >
        <p className="text-[12.5px] font-medium text-[var(--ink)]">
          {confirmed ? 'Holding period, as you have stated it' : `Confirm the holding period to make the ${M.format(zakat.zakatOnWealth)} payable`}
        </p>
        <p className="text-[12.5px] leading-relaxed text-[var(--ink-mute)]">
          {hasLedger
            ? 'Your ledger does not reach back a full lunar year, so only you know what was held before it starts. '
            : 'There is no dated ledger to work from, so these answers decide the holding period. '}
          {confirmed
            ? 'These are the assumptions in use. Change them if they are wrong and the figure updates.'
            : 'Zakat is held as not yet payable until this is confirmed.'}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Toggle
            checked={h.atNisabAtStart}
            onChange={(v) => setWealthFacts({ ...wealthFacts, hawl: { ...h, atNisabAtStart: v } })}
            label="At nisab when the year began"
          />
          <Toggle
            checked={h.atNisabAtEnd}
            onChange={(v) => setWealthFacts({ ...wealthFacts, hawl: { ...h, atNisabAtEnd: v } })}
            label="At nisab when it ended"
          />
          <Toggle
            checked={h.dippedMidYear}
            onChange={(v) => setWealthFacts({ ...wealthFacts, hawl: { ...h, dippedMidYear: v } })}
            label="Dipped below during the year"
          />
        </div>
      </div>
    );
  }
}

function MiniStat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'halal' | 'mixed' }) {
  return (
    <div className="bg-[var(--surface)] px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-mute)]">{label}</p>
      <p
        className="mt-1 text-[16px] font-medium tnum"
        style={{ color: tone ? `var(--data-${tone})` : 'var(--ink)' }}
      >
        {value}
      </p>
      {note && <p className="mt-0.5 text-[11px] capitalize text-[var(--ink-mute)]">{note}</p>}
    </div>
  );
}

// ========================= Scenarios (ScenariosPage.tsx) ===========================
export function ScenariosPage({ onRoute }: { onRoute: (r: Route) => void }) {
  const {
    scenarios,
    activeScenarioId,
    saveScenario,
    loadScenario,
    deleteScenario,
    duplicateScenario,
    renameScenario,
    setWealthFacts,
    setUseLedgerForCash,
    madhhab,
    nisab,
    wealthFacts,
  } = useApp();

  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="Save the current position"
          description="Keeps a copy of everything on the Holdings screen under a name you choose."
        />
        <form
          className="grid gap-3.5 px-5 py-4 sm:grid-cols-[1fr_1.6fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            saveScenario(name, summary);
            setName('');
            setSummary('');
          }}
        >
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Before selling the shares" />
          </Field>
          <Field label="Note" hint="Optional, what makes this position worth keeping.">
            <Input value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="primary" disabled={!name.trim()} className="w-full sm:w-auto">
              Save
            </Button>
          </div>
        </form>
      </Panel>

      {scenarios.length === 0 ? (
        <EmptyState
          title="No saved scenarios"
          description="Save your current holdings above, or start from one of the reference positions below to see how the four schools diverge."
        />
      ) : (
        <Panel>
          <PanelHeader title="Saved" description="Loading a scenario replaces what is on the Holdings screen." />
          <ul className="divide-y divide-[var(--line-soft)]">
            {scenarios.map((s) => {
              const result = computeZakat(madhhab, { wealth: s.facts, nisab, ledgerHawl: null });
              const isActive = s.id === activeScenarioId;
              return (
                <li key={s.id} className="px-5 py-4">
                  {editing === s.id ? (
                    <form
                      className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto_auto]"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const n = (form.elements.namedItem('n') as HTMLInputElement).value;
                        const d = (form.elements.namedItem('d') as HTMLInputElement).value;
                        renameScenario(s.id, n, d);
                        setEditing(null);
                      }}
                    >
                      <Input name="n" defaultValue={s.name} aria-label="Name" />
                      <Input name="d" defaultValue={s.summary} aria-label="Note" />
                      <Button type="submit" variant="primary">
                        Save
                      </Button>
                      <Button type="button" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-[14px] font-medium text-[var(--ink)]">
                          {s.name}
                          {isActive && (
                            <span
                              className="rounded-full px-2 py-[1px] text-[10px] font-medium"
                              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                            >
                              loaded
                            </span>
                          )}
                        </p>
                        {s.summary && <p className="mt-1 text-[12.5px] leading-snug text-[var(--ink-mute)]">{s.summary}</p>}
                        <p className="mt-1.5 text-[11.5px] tnum text-[var(--ink-mute)]">
                          {MADHHAB_LABELS[madhhab]}: {M.format(result.zakatableWealth)} zakatable ·{' '}
                          <span style={{ color: 'var(--accent)' }}>{M.format(result.zakatDue)} due</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        <Button onClick={() => loadScenario(s.id)}>Load</Button>
                        <Button variant="ghost" onClick={() => setEditing(s.id)}>
                          Rename
                        </Button>
                        <Button variant="ghost" onClick={() => duplicateScenario(s.id)}>
                          Duplicate
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`Delete "${s.name}"?`)) deleteScenario(s.id);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <Panel>
        <PanelHeader
          title="Reference positions"
          description="Three positions chosen because each one separates the four schools on a different rule. Loading one replaces your holdings."
        />
        <ul className="divide-y divide-[var(--line-soft)]">
          {scenarioTemplates.map((t) => {
            const result = computeZakat(madhhab, { wealth: t.facts, nisab, ledgerHawl: null });
            return (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-[var(--ink)]">{t.name}</p>
                  <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--ink-mute)]">{t.summary}</p>
                  <p className="mt-1.5 text-[11.5px] tnum text-[var(--ink-mute)]">
                    {MADHHAB_LABELS[madhhab]}: {M.format(result.zakatableWealth)} zakatable ·{' '}
                    <span style={{ color: 'var(--accent)' }}>{M.format(result.zakatDue)} due</span>
                  </p>
                </div>
                <Button
                  className="shrink-0"
                  onClick={() => {
                    setWealthFacts(structuredClone(t.facts));
                    setUseLedgerForCash(false);
                    onRoute('assessment');
                  }}
                >
                  Load
                </Button>
              </li>
            );
          })}
        </ul>
      </Panel>

      {!M.isZero(wealthFacts.cash) && (
        <Notice tone="info">
          Switching schools re-runs whichever position is loaded, the same holdings, assessed by a different rule set.
        </Notice>
      )}
    </div>
  );
}

// =========================== Review (ReviewPage.tsx) ===============================
export function ReviewPage({ onRoute }: { onRoute: (r: Route) => void }) {
  const { classification, zakat, acknowledged, toggleAcknowledged, madhhab } = useApp();

  const queue = classification.lines.filter(
    (l) => l.classification === 'tentative' || l.classification === 'missing_information'
  );
  const totalHeld = M.sum(queue.map((l) => l.amountCad));

  if (queue.length === 0 && zakat.scholarReviewNotes.length === 0) {
    return (
      <EmptyState
        title="Nothing outstanding"
        description="Every record has been classified under a stated rule, and your holdings raise no edge cases under the current school."
        action={<Button onClick={() => onRoute('assessment')}>Back to the assessment</Button>}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Notice tone="info" title="What this queue is for">
        These items are excluded from your zakat figure until they are settled. Take them to someone qualified to
        rule on them, the detail each one needs is stated below.
      </Notice>

      {queue.length > 0 && (
        <Panel>
          <PanelHeader
            title="Unresolved records"
            description="Held out of the assessment."
            actions={<span className="tnum text-[13px] text-[var(--ink-soft)]">{M.format(totalHeld)} held</span>}
          />
          <ul className="divide-y divide-[var(--line-soft)]">
            {queue.map((l) => (
              <li key={l.transactionId} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] text-[var(--ink)]">{l.description || l.keyword.replace(/_/g, ' ')}</span>
                      <StatusBadge status={l.classification} />
                    </div>
                    <p className="mt-1 text-[11.5px] tnum text-[var(--ink-mute)]">
                      {l.date} · {l.merchantOrSource || '·'} · {l.transactionId}
                    </p>
                    <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-[var(--ink-soft)]">{l.explanation}</p>
                    {l.classification === 'missing_information' && (
                      <label className="mt-2.5 inline-flex items-center gap-2 text-[12.5px] text-[var(--ink-soft)]">
                        <input
                          type="checkbox"
                          checked={acknowledged.has(l.transactionId)}
                          onChange={() => toggleAcknowledged(l.transactionId)}
                          className="accent-[var(--accent)]"
                        />
                        Acknowledged, proceed without it
                      </label>
                    )}
                  </div>
                  <span className="shrink-0 tnum text-[14px] text-[var(--ink-soft)]">{M.format(l.amountCad)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {zakat.scholarReviewNotes.length > 0 && (
        <Panel>
          <PanelHeader
            title="Points raised by your holdings"
            description={`Specific to the ${MADHHAB_LABELS[madhhab]} rules.`}
          />
          <ul className="space-y-3 px-5 py-4">
            {zakat.scholarReviewNotes.map((n, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-[var(--ink-soft)]">
                <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full" style={{ background: 'var(--data-tentative)' }} />
                {n}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

// =========================== Rulings (RulingsPage.tsx) =============================
interface RuleSet {
  hawl: string;
  metals: string;
  debts: string;
  receivables: string;
  distinctive: string;
}

const RULES: Record<Madhhab, RuleSet> = {
  hanafi: {
    hawl: 'Wealth must reach nisab at the start and the end of the lunar year. A dip in between does not reset the year.',
    metals: 'All gold and silver counts: bars, coins, and jewellery alike, whether worn, stored, or held as investment.',
    debts: 'Deduct debts due now, overdue, or falling due within twelve months. Not future interest, not-yet-due bills, or the full balance of a long-term mortgage or student loan.',
    receivables: 'Include what you expect to be repaid. Doubtful debts may be left until they are actually received.',
    distinctive: 'The most inclusive treatment of jewellery, and the only one here that tolerates a mid-year dip.',
  },
  maliki: {
    hawl: 'Wealth must stay at or above nisab for a complete lunar year. Falling below resets the start date, and a new year begins when nisab is reached again.',
    metals: 'Bullion, coins, and jewellery held as wealth or investment. Jewellery genuinely worn for customary personal adornment is excluded.',
    debts: 'Deduct debts currently due or expected within twelve months.',
    receivables: 'Money lent privately is not assessed each year while it is outstanding, one year of zakat is calculated when it comes back. Unpaid business invoices are included where repayment is expected.',
    distinctive: 'Draws a line between private lending and trade debt that the other schools here do not.',
  },
  shafii: {
    hawl: 'Wealth must stay at or above nisab for a complete lunar year; falling below resets it.',
    metals: 'Bullion, coins, savings metal, investment or resale jewellery, and business jewellery stock. Customary personal jewellery is excluded.',
    debts: 'Personal debts are never deducted, not credit cards, student loans, mortgage payments, personal loans, or current bills.',
    receivables: 'Anything likely to be repaid is assessed every year, without waiting for it to arrive. Doubtful amounts are flagged instead.',
    distinctive: 'The only formula here with no deduction for debt at all; it assesses gross, not net.',
  },
  hanbali: {
    hawl: 'Wealth must stay at or above nisab for a complete lunar year. Any dip at all resets it.',
    metals: 'Bullion, bars, coins, hoarded savings, trade jewellery, and jewellery that is excessive or otherwise impermissible. Customary personal jewellery is excluded, and borderline pieces go to review rather than being decided by the calculator.',
    debts: 'Deduct the full outstanding balance owed to creditors regardless of when it falls due, including the entire remaining mortgage.',
    receivables: 'Money lent to others is excluded outright while unpaid. It is not treated as doubtful; it simply does not enter the calculation.',
    distinctive: 'Shares are not trade goods and never enter the calculation. If they are sold and the proceeds sit as cash through a full year, the cash is assessed, never the shares.',
  },
};

export function RulingsPage() {
  const { madhhab } = useApp();
  const [open, setOpen] = useState<Madhhab>(madhhab);

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader title="How this assessment works" />
        <div className="space-y-4 px-5 py-5 text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
          <p>
            Every transaction passes through one classification stage that is the same whatever school you follow, the schools differ on which <em>wealth</em> is assessable, not on whether a given income stream is
            permissible. Each record is assigned exactly one verdict: permissible, impermissible, mixed, unresolved,
            or incomplete. Ordinary spending never enters that stage at all.
          </p>
          <p>
            Linked records are reconciled before anything is counted. Transfers between your own accounts cancel;
            a gross sale, its processing fee, and the settlement that follows are counted once, at the amount that
            actually arrived; refunds reduce the sale they reverse; and a payment recorded twice under the same
            reference is caught and counted once.
          </p>
          <p>
            Only then does the selected school's rule set apply, to decide which holdings are assessable and what
            may be deducted. The two stages never mix, which is what keeps the four rule sets from leaking into one
            another.
          </p>
          <p>
            Amounts are held as whole cents throughout, so the figures shown are exactly the figures used, no
            rounding drift between the breakdown and the total. The nisab threshold is derived from{' '}
            {GOLD_NISAB_GRAMS} g of gold or {SILVER_NISAB_GRAMS} g of silver at the fixed price you set, and the
            holding period is measured on the {usingUmmAlQura ? 'Umm al-Qura' : 'tabular Islamic'} lunar calendar
            rather than a 365-day approximation.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="The four rule sets"
          description="Only the school you have selected is applied. The others are shown so you can see exactly where they part company."
        />
        <ul className="divide-y divide-[var(--line-soft)]">
          {MADHHAB_ORDER.map((m) => {
            const isOpen = open === m;
            const isActive = m === madhhab;
            const r = RULES[m];
            return (
              <li key={m}>
                <button
                  onClick={() => setOpen(isOpen ? ('' as Madhhab) : m)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors duration-200 hover:bg-[var(--ground)]"
                >
                  <span className="flex items-center gap-2.5">
                    <span className="font-display text-[16px] text-[var(--ink)]">{MADHHAB_LABELS[m]}</span>
                    {isActive && (
                      <span
                        className="rounded-full px-2 py-[1px] text-[10px] font-medium"
                        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        in use
                      </span>
                    )}
                  </span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="shrink-0 text-[var(--ink-mute)] transition-transform duration-300"
                    style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
                    aria-hidden
                  >
                    <path d="M2.5 4.5L6 8l3.5-3.5" strokeLinecap="round" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="animate-fade space-y-3.5 px-5 pb-5">
                    <Rule label="Holding period">{r.hawl}</Rule>
                    <Rule label="Gold and silver">{r.metals}</Rule>
                    <Rule label="Debts">{r.debts}</Rule>
                    <Rule label="Owed to you">{r.receivables}</Rule>
                    <Rule label="What sets it apart">{r.distinctive}</Rule>
                    <div className="rounded-lg border border-[var(--line)] bg-[var(--ground)] px-3.5 py-3">
                      <p className="text-[10.5px] font-medium uppercase tracking-wide text-[var(--ink-mute)]">Formula</p>
                      <p className="mt-1 font-mono text-[11.5px] leading-relaxed text-[var(--ink-soft)]">
                        {MADHHAB_FORMULAS[m]}
                      </p>
                      <p className="mt-2 font-mono text-[11.5px] text-[var(--ink-mute)]">
                        Zakat = 2.5% × the above, once nisab and the holding period are both met
                      </p>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel>
        <PanelHeader title="Limits of this tool" />
        <ul className="space-y-2.5 px-5 py-4 text-[13px] leading-relaxed text-[var(--ink-soft)]">
          {[
            'The rule sets are simplified working definitions. A specialist in any of these schools will recognise detail that sits outside their scope.',
            'Bank interest is treated as riba and separated from assessable wealth. That is a stated position, not a neutral one.',
            'Metal prices are the fixed figures you enter. Nothing here reads a market rate, so the threshold is only as current as your input.',
            'Cashback, unscreened fund distributions, and crowdfunding are routed to review rather than decided, because the answer depends on contract terms this tool cannot see.',
            `Zakat on agricultural produce, livestock, and mineral extraction is out of scope, this assesses monetary wealth only.`,
            'Nothing here is a religious ruling. Where a case is unresolved, the tool says so and stops.',
          ].map((t, i) => (
            <li key={i} className="flex gap-2.5">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--ink-mute)]" />
              {t}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Rule({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--accent)' }}>
        {label}
      </p>
      <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-[var(--ink-soft)]">{children}</p>
    </div>
  );
}
